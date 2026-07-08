import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  ActivityIndicator, 
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCATION_TASK_NAME = 'background-location-task';
const FIREBASE_DB_URL = 'https://balance-hidrico-ghlg-default-rtdb.firebaseio.com';

// Definición de la tarea de GPS en segundo plano en ámbito global
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("Error en tarea de GPS en segundo plano:", error);
    return;
  }
  if (data) {
    const { locations } = data;
    if (locations && locations.length > 0) {
      try {
        const newPoints = locations.map(loc => ({
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          timestamp: loc.timestamp,
          accuracy: loc.coords.accuracy
        }));
        
        const existingTrackStr = await AsyncStorage.getItem('@gps_track');
        const existingTrack = existingTrackStr ? JSON.parse(existingTrackStr) : [];
        const updatedTrack = [...existingTrack, ...newPoints];
        
        await AsyncStorage.setItem('@gps_track', JSON.stringify(updatedTrack));
      } catch (err) {
        console.error("Error al guardar punto GPS en segundo plano:", err);
      }
    }
  }
});

export default function App() {
  // Estados de Navegación y Login
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [currentTab, setCurrentTab] = useState('datos'); // 'datos' | 'sincronizacion'

  // Estados del Formulario
  const [finca, setFinca] = useState('01'); // '01' | '02' | '03'
  const [subsector, setSubsector] = useState('');
  const [lote, setLote] = useState('');
  const [linea, setLinea] = useState('');
  const [palma, setPalma] = useState('');
  const [observacion, setObservacion] = useState('');

  // Estados de "Fijar" (Pinning)
  const [pinFinca, setPinFinca] = useState(false);
  const [pinSubsector, setPinSubsector] = useState(false);
  const [pinLote, setPinLote] = useState(false);
  const [pinLinea, setPinLinea] = useState(false);
  const [pinPalma, setPinPalma] = useState(false);

  // Estados de Tracking e Historial
  const [isTracking, setIsTracking] = useState(false);
  const [pendingFormsCount, setPendingFormsCount] = useState(0);
  const [pendingGpsCount, setPendingGpsCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Inicialización de Estados al Abrir la App
  useEffect(() => {
    const loadSessionAndStats = async () => {
      try {
        const logged = await AsyncStorage.getItem('@is_logged_in');
        if (logged === 'true') {
          setIsLoggedIn(true);
        }
        
        // Validar si el servicio de tracking sigue activo
        const trackingActive = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        setIsTracking(trackingActive);

        // Cargar contadores de pendientes
        updateLocalStats();
      } catch (e) {
        console.error("Error cargando configuración inicial:", e);
      }
    };

    loadSessionAndStats();
  }, []);

  // Actualizar estadísticas de registros locales pendientes
  const updateLocalStats = async () => {
    try {
      const formsStr = await AsyncStorage.getItem('@forms_data');
      const forms = formsStr ? JSON.parse(formsStr) : [];
      setPendingFormsCount(forms.length);

      const trackStr = await AsyncStorage.getItem('@gps_track');
      const track = trackStr ? JSON.parse(trackStr) : [];
      setPendingGpsCount(track.length);
    } catch (e) {
      console.error("Error al actualizar estadísticas locales:", e);
    }
  };

  // Mostrar mensaje Toast autodescartable
  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  };

  // Manejar Login
  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Campos requeridos", "Por favor ingresa tu usuario y contraseña.");
      return;
    }

    setLoadingAuth(true);
    
    // Lista de usuarios y contraseñas locales (fallback offline)
    const localUsers = {
      "admin": "hlg2026#",
      "sanidad1": "sanidad2026#",
      "cosecha1": "cosecha2026#"
    };

    try {
      // Intentar validar contra Firebase usando la lista en Realtime Database
      const response = await fetch(`${FIREBASE_DB_URL}/registros/usuarios.json`);
      let authenticated = false;
      const typedUser = username.trim();
      
      if (response.ok) {
        const usersList = await response.json();
        if (usersList && usersList[typedUser]) {
          const uData = usersList[typedUser];
          if (uData.password === password) {
            authenticated = true;
          }
        }
      } else {
        // Fallback local si la petición falla pero hay respuesta del servidor
        if (localUsers[typedUser] === password) {
          authenticated = true;
        }
      }

      if (authenticated) {
        setIsLoggedIn(true);
        await AsyncStorage.setItem('@is_logged_in', 'true');
        await AsyncStorage.setItem('@logged_user', typedUser);
        
        // Activar rastreo GPS en segundo plano inmediatamente después del login
        await startLocationTracking();
      } else {
        Alert.alert("Acceso denegado", "Usuario o contraseña incorrectos.");
      }
    } catch (err) {
      console.error(err);
      // Fallback local en caso de error de red completo (offline total)
      const typedUser = username.trim();
      if (localUsers[typedUser] === password) {
        setIsLoggedIn(true);
        await AsyncStorage.setItem('@is_logged_in', 'true');
        await AsyncStorage.setItem('@logged_user', typedUser);
        await startLocationTracking();
      } else {
        Alert.alert("Error de conexión", "No se pudo contactar al servidor. Revisa tu internet.");
      }
    } finally {
      setLoadingAuth(false);
    }
  };

  // Iniciar Rastreo GPS
  const startLocationTracking = async () => {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert("Permiso denegado", "Se requiere el permiso de ubicación para registrar los datos.");
        return;
      }

      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        Alert.alert("Permiso de segundo plano", "Se requiere permitir la ubicación en segundo plano ('Todo el tiempo') para poder rastrear tu recorrido con la pantalla bloqueada.");
        return;
      }

      // Iniciar actualizaciones de segundo plano
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15000, // Cada 15 segundos
        distanceInterval: 8, // Cada 8 metros
        foregroundService: {
          notificationTitle: "Rastreo GPS Activo",
          notificationBody: "Monitoreando coordenadas de recorrido en campo...",
          notificationColor: "#00f2fe"
        }
      });
      
      setIsTracking(true);
      console.log("Rastreo GPS en segundo plano activado.");
    } catch (e) {
      console.error("Error al iniciar el rastreo GPS:", e);
      Alert.alert("Error GPS", "No se pudo iniciar el servicio de ubicación.");
    }
  };

  // Detener Rastreo GPS
  const stopLocationTracking = async () => {
    try {
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (running) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
      setIsTracking(false);

      // Limpiar absolutamente todos los campos del formulario
      setFinca('01');
      setSubsector('');
      setLote('');
      setLinea('');
      setPalma('');
      setObservacion('');

      // Apagar todos los candados de fijado (pines)
      setPinFinca(false);
      setPinSubsector(false);
      setPinLote(false);
      setPinLinea(false);
      setPinPalma(false);

      Alert.alert("Trabajo Finalizado", "El rastreo GPS se ha detenido y se han limpiado todos los campos del formulario.");
    } catch (e) {
      console.error("Error al detener el rastreo GPS:", e);
    }
  };

  // Guardar Formulario Localmente
  const handleSaveForm = async () => {
    if (!subsector.trim() || !lote.trim() || !linea.trim() || !palma.trim()) {
      Alert.alert("Campos requeridos", "Por favor completa todos los campos del formulario (excepto observación).");
      return;
    }

    try {
      // Capturar coordenada GPS actual de manera instantánea (última conocida por el dispositivo)
      let currentCoords = null;
      try {
        const loc = await Location.getLastKnownPositionAsync();
        if (loc) {
          currentCoords = {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            timestamp: loc.timestamp
          };
        }
      } catch (gpsErr) {
        console.warn("No se pudo obtener la última posición GPS conocida:", gpsErr);
      }

      // Crear nuevo registro de formulario
      const loggedUser = await AsyncStorage.getItem('@logged_user') || 'admin';
      const formRecord = {
        id: `form-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        finca,
        subsector: subsector.trim(),
        lote: lote.trim(),
        linea: linea.trim(),
        palma: palma.trim(),
        observacion: observacion.trim(),
        gps: currentCoords,
        usuario: loggedUser,
        timestamp: Date.now()
      };

      // Cargar cola de formularios locales
      const formsStr = await AsyncStorage.getItem('@forms_data');
      const forms = formsStr ? JSON.parse(formsStr) : [];
      forms.push(formRecord);

      // Guardar en AsyncStorage
      await AsyncStorage.setItem('@forms_data', JSON.stringify(forms));

      // Lógica de limpieza basada en "Fijar"
      if (!pinFinca) setFinca('01');
      if (!pinSubsector) setSubsector('');
      if (!pinLote) setLote('');
      if (!pinLinea) setLinea('');
      if (!pinPalma) setPalma('');
      setObservacion(''); // Observación nunca se fija

      // Feedback visual inmediato no bloqueante (Toast)
      triggerToast("✓ Registro guardado localmente");
      updateLocalStats();
    } catch (e) {
      console.error("Error al guardar el formulario:", e);
      Alert.alert("Error", "Ocurrió un error al guardar los datos localmente.");
    }
  };

  // Detener el trabajo por hoy
  const handleStopDay = () => {
    Alert.alert(
      "Finalizar jornada",
      "¿Estás seguro de que deseas finalizar la jornada de trabajo? Esto detendrá el rastreo GPS.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Detener Trabajo", onPress: () => stopLocationTracking(), style: "destructive" }
      ]
    );
  };

  // Sincronizar todos los datos acumulados con Firebase Cloud
  const handleSyncData = async () => {
    if (pendingFormsCount === 0 && pendingGpsCount === 0) {
      Alert.alert("Sin datos", "No tienes datos pendientes por sincronizar en este momento.");
      return;
    }

    setSyncing(true);
    try {
      // 1. Sincronizar Formularios de Campo
      const formsStr = await AsyncStorage.getItem('@forms_data');
      const forms = formsStr ? JSON.parse(formsStr) : [];

      if (forms.length > 0) {
        // Enviar en lote individualmente o agrupado
        for (const item of forms) {
          await fetch(`${FIREBASE_DB_URL}/lecturas_campo/${item.id}.json`, {
            method: 'PUT',
            body: JSON.stringify(item)
          });
        }
      }

      // 2. Sincronizar Puntos GPS de Recorridos
      const trackStr = await AsyncStorage.getItem('@gps_track');
      const track = trackStr ? JSON.parse(trackStr) : [];

      if (track.length > 0) {
        const loggedUser = await AsyncStorage.getItem('@logged_user') || 'admin';
        // Para no saturar con miles de requests, subimos el recorrido completo bajo un ID único por jornada
        const trackId = `track-${Date.now()}`;
        await fetch(`${FIREBASE_DB_URL}/campo_recorridos/${trackId}.json`, {
          method: 'PUT',
          body: JSON.stringify({
            id: trackId,
            usuario: loggedUser,
            timestamp: Date.now(),
            recorrido: track
          })
        });
      }

      // Limpiar AsyncStorage local
      await AsyncStorage.setItem('@forms_data', JSON.stringify([]));
      await AsyncStorage.setItem('@gps_track', JSON.stringify([]));

      Alert.alert("Sincronización Exitosa", "Todos los formularios y recorridos GPS han sido subidos a la nube.");
      updateLocalStats();
    } catch (err) {
      console.error("Error al sincronizar con Firebase:", err);
      Alert.alert("Fallo de sincronización", "Ocurrió un error al subir los datos. Asegúrate de tener conexión a internet estable.");
    } finally {
      setSyncing(false);
    }
  };

  // Cerrar Sesión
  const handleLogout = async () => {
    Alert.alert(
      "Cerrar sesión",
      "¿Deseas cerrar sesión en esta unidad? Esto detendrá el rastreo GPS.",
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: "Cerrar Sesión", 
          onPress: async () => {
            await stopLocationTracking();
            await AsyncStorage.setItem('@is_logged_in', 'false');
            setIsLoggedIn(false);
          }, 
          style: "destructive" 
        }
      ]
    );
  };

  // --- VISTA DE LOGIN ---
  if (!isLoggedIn) {
    return (
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.authContainer}
      >
        <StatusBar style="light" />
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>GAHLG MÓVIL</Text>
          <Text style={styles.authSubtitle}>Rastreo GPS y Captura de Palma</Text>

          <TextInput 
            style={styles.input}
            placeholder="Usuario"
            placeholderTextColor="#636b77"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />

          <TextInput 
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor="#636b77"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity 
            style={styles.loginBtn} 
            onPress={handleLogin}
            disabled={loadingAuth}
          >
            {loadingAuth ? (
              <ActivityIndicator color="#051829" />
            ) : (
              <Text style={styles.loginBtnText}>Iniciar Sesión</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // --- VISTA PRINCIPAL (LOGUEADO) ---
  return (
    <View style={styles.mainContainer}>
      <StatusBar style="light" />
      
      {toastMessage && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
      
      {/* Cabecera */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>GAHLG Campo</Text>
          <Text style={[styles.headerSubtitle, { color: isTracking ? '#00e676' : '#ff9100' }]}>
            {isTracking ? '● GPS Activo en 2º Plano' : '● GPS Inactivo'}
          </Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Contenido Principal según la pestaña */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {currentTab === 'datos' ? (
          <View style={styles.tabView}>
            <Text style={styles.sectionTitle}>Ingreso de Lectura</Text>
            
            {/* Campo: Finca */}
            <View style={styles.fieldContainer}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Finca *</Text>
                <TouchableOpacity 
                  style={[styles.pinBtn, pinFinca && styles.pinBtnActive]} 
                  onPress={() => setPinFinca(!pinFinca)}
                >
                  <Text style={styles.pinBtnText}>{pinFinca ? '🔒 Fijado' : '🔓 Fijar'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.fincaButtonGroup}>
                {['01', '02', '03'].map(id => (
                  <TouchableOpacity
                    key={id}
                    style={[styles.fincaOption, finca === id && styles.fincaOptionActive]}
                    onPress={() => setFinca(id)}
                  >
                    <Text style={[styles.fincaOptionText, finca === id && styles.fincaOptionTextActive]}>
                      Finca {id}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Campo: Subsector */}
            <View style={styles.fieldContainer}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Subsector *</Text>
                <TouchableOpacity 
                  style={[styles.pinBtn, pinSubsector && styles.pinBtnActive]} 
                  onPress={() => setPinSubsector(!pinSubsector)}
                >
                  <Text style={styles.pinBtnText}>{pinSubsector ? '🔒 Fijado' : '🔓 Fijar'}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.fieldInput}
                placeholder="Escribe el subsector"
                placeholderTextColor="#636b77"
                value={subsector}
                onChangeText={setSubsector}
              />
            </View>

            {/* Campo: Lote */}
            <View style={styles.fieldContainer}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Lote *</Text>
                <TouchableOpacity 
                  style={[styles.pinBtn, pinLote && styles.pinBtnActive]} 
                  onPress={() => setPinLote(!pinLote)}
                >
                  <Text style={styles.pinBtnText}>{pinLote ? '🔒 Fijado' : '🔓 Fijar'}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.fieldInput}
                placeholder="Número de Lote"
                placeholderTextColor="#636b77"
                value={lote}
                onChangeText={setLote}
                keyboardType="numeric"
              />
            </View>

            {/* Campo: Línea */}
            <View style={styles.fieldContainer}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Línea *</Text>
                <TouchableOpacity 
                  style={[styles.pinBtn, pinLinea && styles.pinBtnActive]} 
                  onPress={() => setPinLinea(!pinLinea)}
                >
                  <Text style={styles.pinBtnText}>{pinLinea ? '🔒 Fijado' : '🔓 Fijar'}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.fieldInput}
                placeholder="Número de Línea"
                placeholderTextColor="#636b77"
                value={linea}
                onChangeText={setLinea}
                keyboardType="numeric"
              />
            </View>

            {/* Campo: Palma */}
            <View style={styles.fieldContainer}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Palma *</Text>
                <TouchableOpacity 
                  style={[styles.pinBtn, pinPalma && styles.pinBtnActive]} 
                  onPress={() => setPinPalma(!pinPalma)}
                >
                  <Text style={styles.pinBtnText}>{pinPalma ? '🔒 Fijado' : '🔓 Fijar'}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.fieldInput}
                placeholder="Número de Palma"
                placeholderTextColor="#636b77"
                value={palma}
                onChangeText={setPalma}
                keyboardType="numeric"
              />
            </View>

            {/* Campo: Observación */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Observación (Opcional)</Text>
              <TextInput
                style={[styles.fieldInput, { height: 80, textAlignVertical: 'top' }]}
                placeholder="Escribe algún comentario..."
                placeholderTextColor="#636b77"
                value={observacion}
                onChangeText={setObservacion}
                multiline
              />
            </View>

            {/* Acciones del Formulario */}
            <TouchableOpacity style={styles.submitBtn} onPress={handleSaveForm}>
              <Text style={styles.submitBtnText}>Enviar Formulario</Text>
            </TouchableOpacity>

            {isTracking && (
              <TouchableOpacity style={styles.stopDayBtn} onPress={handleStopDay}>
                <Text style={styles.stopDayBtnText}>Detener Trabajo por Hoy</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.tabView}>
            <Text style={styles.sectionTitle}>Sincronización en la Nube</Text>
            
            <View style={styles.syncCard}>
              <Text style={styles.syncCardTitle}>Datos Pendientes de Subida</Text>
              
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Lecturas de Formularios:</Text>
                <Text style={styles.syncValue}>{pendingFormsCount}</Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Puntos GPS del Recorrido:</Text>
                <Text style={styles.syncValue}>{pendingGpsCount}</Text>
              </View>
            </View>

            <TouchableOpacity 
              style={[styles.syncBtn, (pendingFormsCount === 0 && pendingGpsCount === 0) && styles.syncBtnDisabled]} 
              onPress={handleSyncData}
              disabled={syncing || (pendingFormsCount === 0 && pendingGpsCount === 0)}
            >
              {syncing ? (
                <ActivityIndicator color="#051829" />
              ) : (
                <Text style={styles.syncBtnText}>Sincronizar</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.syncHelp}>
              Al presionar "Sincronizar", se conectará a Firebase Realtime Database para cargar todas las lecturas de palma y el recorrido GPS guardado en segundo plano de manera masiva.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Barra de Navegación Inferior (Tabs) */}
      <View style={styles.navigationBar}>
        <TouchableOpacity 
          style={[styles.navTab, currentTab === 'datos' && styles.navTabActive]} 
          onPress={() => setCurrentTab('datos')}
        >
          <Text style={[styles.navTabText, currentTab === 'datos' && styles.navTabTextActive]}>
            Ingreso de Datos
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.navTab, currentTab === 'sincronizacion' && styles.navTabActive]} 
          onPress={() => {
            setCurrentTab('sincronizacion');
            updateLocalStats();
          }}
        >
          <Text style={[styles.navTabText, currentTab === 'sincronizacion' && styles.navTabTextActive]}>
            Sincronización
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Contenedor Auth
  authContainer: {
    flex: 1,
    backgroundColor: '#070a13',
    justifyContent: 'center',
    padding: 20,
  },
  authCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  authTitle: {
    color: '#00f2fe',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: 1,
  },
  authSubtitle: {
    color: '#636b77',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
  },
  input: {
    backgroundColor: '#0c0f1a',
    borderRadius: 8,
    padding: 14,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 16,
  },
  loginBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnText: {
    color: '#051829',
    fontSize: 16,
    fontWeight: '700',
  },

  // Contenedor Principal App
  mainContainer: {
    flex: 1,
    backgroundColor: '#070a13',
    paddingTop: Platform.OS === 'ios' ? 50 : 35,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: '#0c0f1a',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: 'rgba(255, 75, 75, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 75, 0.3)',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  logoutBtnText: {
    color: '#ff4b4b',
    fontSize: 12,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  tabView: {
    flex: 1,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
  },

  // Campos de Formulario
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fieldLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  pinBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  pinBtnActive: {
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    borderColor: '#00f2fe',
  },
  pinBtnText: {
    color: '#cbd5e0',
    fontSize: 11,
    fontWeight: 'bold',
  },
  fieldInput: {
    backgroundColor: '#0c0f1a',
    borderRadius: 8,
    padding: 12,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },

  // Finca select button group
  fincaButtonGroup: {
    flexDirection: 'row',
    gap: 10,
  },
  fincaOption: {
    flex: 1,
    backgroundColor: '#0c0f1a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  fincaOptionActive: {
    backgroundColor: 'rgba(0, 242, 254, 0.1)',
    borderColor: '#00f2fe',
  },
  fincaOptionText: {
    color: '#a0aec0',
    fontSize: 14,
    fontWeight: '600',
  },
  fincaOptionTextActive: {
    color: '#00f2fe',
    fontWeight: 'bold',
  },

  // Botones Acciones
  submitBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#00f2fe',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  submitBtnText: {
    color: '#051829',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stopDayBtn: {
    backgroundColor: 'rgba(255, 75, 75, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 75, 0.3)',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 15,
  },
  stopDayBtnText: {
    color: '#ff4b4b',
    fontSize: 15,
    fontWeight: 'bold',
  },

  // Tab Sincronización
  syncCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  syncCardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 15,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 10,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  syncLabel: {
    color: '#a0aec0',
    fontSize: 14,
  },
  syncValue: {
    color: '#00f2fe',
    fontSize: 18,
    fontWeight: 'bold',
  },
  syncBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 15,
  },
  syncBtnDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    opacity: 0.5,
  },
  syncBtnText: {
    color: '#051829',
    fontSize: 16,
    fontWeight: 'bold',
  },
  syncHelp: {
    color: '#636b77',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 10,
  },

  // Barra de Navegación Inferior
  navigationBar: {
    flexDirection: 'row',
    height: 60,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: '#0c0f1a',
  },
  navTab: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navTabActive: {
    borderTopWidth: 3,
    borderTopColor: '#00f2fe',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  navTabText: {
    color: '#636b77',
    fontSize: 13,
    fontWeight: '600',
  },
  navTabTextActive: {
    color: '#00f2fe',
    fontWeight: 'bold',
  },
  toastContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 80,
    left: 20,
    right: 20,
    backgroundColor: '#00e676',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    zIndex: 9999,
    alignItems: 'center',
    shadowColor: '#00e676',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  toastText: {
    color: '#051829',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
