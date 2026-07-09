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

  // Estados de Formularios Dinámicos
  const [assignedForms, setAssignedForms] = useState([]);
  const [selectedForm, setSelectedForm] = useState(null);
  const [laborActive, setLaborActive] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [pinnedFields, setPinnedFields] = useState({});
  
  // Estado de permisos y tracking
  const [isTracking, setIsTracking] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const [pendingFormsCount, setPendingFormsCount] = useState(0);
  const [pendingGpsCount, setPendingGpsCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Sincronizar formularios asignados desde Firebase Cloud
  const syncAssignedFormsFromServer = async (username) => {
    try {
      const userRes = await fetch(FIREBASE_DB_URL + '/registros/usuarios/' + username + '.json');
      if (!userRes.ok) return;
      const uData = await userRes.json();
      if (!uData || uData.status === 'solicitado_eliminar' || uData.status === 'eliminando') {
        return;
      }
      
      const userArea = uData.area || '';
      let forms = [];
      
      if (username === 'admin') {
        const formsRes = await fetch(FIREBASE_DB_URL + '/registros/configuracion_formularios.json');
        if (formsRes.ok) {
          const allData = await formsRes.json();
          if (allData) {
            Object.values(allData).forEach(areaData => {
              if (areaData && areaData.formularios) {
                forms = [...forms, ...areaData.formularios];
              }
            });
          }
        }
      } else {
        const formsRes = await fetch(FIREBASE_DB_URL + '/registros/configuracion_formularios/' + userArea + '.json');
        if (formsRes.ok) {
          const formsData = await formsRes.json();
          if (formsData && formsData.formularios) {
            forms = formsData.formularios;
          }
        }
        
        if (uData.formularios_permitidos) {
          forms = forms.filter(f => uData.formularios_permitidos[f.id] !== false);
        }
      }
      
      if (forms.length > 0) {
        await AsyncStorage.setItem('@assigned_forms_' + username, JSON.stringify(forms));
        await AsyncStorage.setItem('@user_area_' + username, userArea);
        setAssignedForms(forms);
        const activeLabor = await AsyncStorage.getItem('@labor_active_' + username);
        if (activeLabor !== 'true') {
          if (forms.length === 1) {
            setSelectedForm(forms[0]);
          } else {
            setSelectedForm(null);
          }
        }
      }
    } catch (err) {
      console.warn("Error al sincronizar formularios de red:", err);
    }
  };

  // Polling para actualizar estadísticas locales periódicamente cuando la labor está activa
  useEffect(() => {
    let interval = null;
    if (laborActive) {
      updateLocalStats();
      interval = setInterval(() => {
        updateLocalStats();
      }, 3000);
    } else {
      updateLocalStats();
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [laborActive]);

  // Inicialización de Estados al Abrir la App
  useEffect(() => {
    const loadSessionAndStats = async () => {
      try {
        const logged = await AsyncStorage.getItem('@is_logged_in');
        const typedUser = await AsyncStorage.getItem('@logged_user');
        if (logged === 'true' && typedUser) {
          setIsLoggedIn(true);
          
          // Cargar formularios en caché para este usuario
          const cachedFormsStr = await AsyncStorage.getItem('@assigned_forms_' + typedUser);
          if (cachedFormsStr) {
            const forms = JSON.parse(cachedFormsStr);
            setAssignedForms(forms);
            if (forms.length === 1) {
              setSelectedForm(forms[0]);
            }
          }
          
          // Cargar estado de labor activa
          const activeLaborStr = await AsyncStorage.getItem('@labor_active_' + typedUser);
          if (activeLaborStr === 'true') {
            setLaborActive(true);
            const activeFormId = await AsyncStorage.getItem('@active_form_id_' + typedUser);
            if (activeFormId && cachedFormsStr) {
              const forms = JSON.parse(cachedFormsStr);
              const matched = forms.find(f => f.id === activeFormId);
              if (matched) setSelectedForm(matched);
            }
          }

          // Cargar valores fijados (pinned)
          const cachedPinnedStr = await AsyncStorage.getItem('@pinned_fields_' + typedUser);
          if (cachedPinnedStr) {
            setPinnedFields(JSON.parse(cachedPinnedStr));
          }

          // Cargar formValues guardados
          const cachedValuesStr = await AsyncStorage.getItem('@form_values_' + typedUser);
          if (cachedValuesStr) {
            setFormValues(JSON.parse(cachedValuesStr));
          }

          // Descargar formularios actualizados de la nube en segundo plano
          syncAssignedFormsFromServer(typedUser);
        }
        
        // Validar si el servicio de tracking sigue activo
        const trackingActive = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        setIsTracking(trackingActive);

        // Validar permisos de GPS
        const { status: fg } = await Location.getForegroundPermissionsAsync();
        const { status: bg } = await Location.getBackgroundPermissionsAsync();
        if (fg !== 'granted' || bg !== 'granted') {
          setGpsError(true);
        } else {
          setGpsError(false);
        }

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
    const typedUser = username.trim();

    try {
      // 1. Obtener información del usuario desde Firebase
      const response = await fetch(FIREBASE_DB_URL + '/registros/usuarios/' + typedUser + '.json');
      let authenticated = false;
      let userArea = '';

      if (response.ok) {
        const uData = await response.json();
        if (uData && uData.password === password) {
          if (uData.status === 'solicitado_eliminar' || uData.status === 'eliminando') {
            Alert.alert("Acceso Denegado", "Su usuario ha sido inhabilitado para el trabajo de campo por su supervisor.");
            setLoadingAuth(false);
            return;
          }
          authenticated = true;
          userArea = uData.area || '';
        }
      } else {
        // Fallback local básico
        const localUsers = {
          "admin": "hlg2026#",
          "sanidad1": "sanidad2026#",
          "cosecha1": "cosecha2026#"
        };
        if (localUsers[typedUser] === password) {
          authenticated = true;
          userArea = typedUser.startsWith('sanidad') ? 'Sanidad' : (typedUser.startsWith('cosecha') ? 'Cosecha' : 'Administración');
        }
      }

      if (authenticated) {
        // 2. Descargar formularios según el rol del usuario
        let forms = [];
        try {
          if (typedUser === 'admin') {
            // Admin descarga todos los formularios de todas las áreas
            const formsRes = await fetch(FIREBASE_DB_URL + '/registros/configuracion_formularios.json');
            if (formsRes.ok) {
              const allData = await formsRes.json();
              if (allData) {
                Object.values(allData).forEach(areaData => {
                  if (areaData && areaData.formularios) {
                    forms = [...forms, ...areaData.formularios];
                  }
                });
              }
            }
          } else {
            // Operario descarga solo los formularios de su área
            const formsRes = await fetch(FIREBASE_DB_URL + '/registros/configuracion_formularios/' + userArea + '.json');
            if (formsRes.ok) {
              const formsData = await formsRes.json();
              if (formsData && formsData.formularios) {
                forms = formsData.formularios;
              }
            }
            
            // Descargar el perfil de usuario actual para filtrar por permisos chuleados
            const userProfileRes = await fetch(FIREBASE_DB_URL + '/registros/usuarios/' + typedUser + '.json');
            if (userProfileRes.ok) {
              const uData = await userProfileRes.json();
              if (uData && uData.formularios_permitidos) {
                forms = forms.filter(f => uData.formularios_permitidos[f.id] !== false);
              }
            }
          }
        } catch (fErr) {
          console.warn("No se pudieron descargar los formularios nuevos de red:", fErr);
        }

        // Si falló la red o no hay formularios, pero tenemos en caché anterior
        if (forms.length === 0) {
          const cached = await AsyncStorage.getItem('@assigned_forms_' + typedUser);
          if (cached) forms = JSON.parse(cached);
        }

        // Guardar en AsyncStorage para uso offline
        await AsyncStorage.setItem('@assigned_forms_' + typedUser, JSON.stringify(forms));
        await AsyncStorage.setItem('@user_area_' + typedUser, userArea);

        // Actualizar estados
        setAssignedForms(forms);
        if (forms.length === 1) {
          setSelectedForm(forms[0]);
        } else {
          setSelectedForm(null);
        }

        setIsLoggedIn(true);
        await AsyncStorage.setItem('@is_logged_in', 'true');
        await AsyncStorage.setItem('@logged_user', typedUser);

        // Resetear estados de labor al iniciar sesión
        setLaborActive(false);
        await AsyncStorage.setItem('@labor_active_' + typedUser, 'false');
        await AsyncStorage.setItem('@active_form_id_' + typedUser, '');

        updateLocalStats();
      } else {
        Alert.alert("Acceso denegado", "Usuario o contraseña incorrectos.");
      }
    } catch (err) {
      console.error(err);
      // Fallback offline completo
      const cachedFormsStr = await AsyncStorage.getItem('@assigned_forms_' + typedUser);
      const localUsers = {
        "admin": "hlg2026#",
        "sanidad1": "sanidad2026#",
        "cosecha1": "cosecha2026#"
      };
      if (localUsers[typedUser] === password) {
        let forms = [];
        if (cachedFormsStr) forms = JSON.parse(cachedFormsStr);
        setAssignedForms(forms);
        if (forms.length === 1) setSelectedForm(forms[0]);

        setIsLoggedIn(true);
        await AsyncStorage.setItem('@is_logged_in', 'true');
        await AsyncStorage.setItem('@logged_user', typedUser);
        updateLocalStats();
      } else {
        Alert.alert("Error de conexión", "No se pudo contactar al servidor. Revisa tu internet.");
      }
    } finally {
      setLoadingAuth(false);
    }
  };

  // Iniciar Labor / Tracking GPS
  const handleStartLabor = async () => {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        setGpsError(true);
        Alert.alert("Permiso denegado", "Se requiere el permiso de ubicación para registrar los datos.");
        return;
      }

      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        setGpsError(true);
        Alert.alert("Permiso de segundo plano", "Se requiere permitir la ubicación en segundo plano ('Todo el tiempo') para poder rastrear tu recorrido con la pantalla bloqueada.");
        return;
      }

      setGpsError(false);

      // Iniciar actualizaciones de segundo plano con alta precisión
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000, // Cada 1 segundo
        distanceInterval: 1, // Cada 1 metro
        foregroundService: {
          notificationTitle: "Labor Activa",
          notificationBody: selectedForm ? 'Labor activa: ' + selectedForm.titulo : "Registrando datos de la labor en segundo plano...",
          notificationColor: "#00f2fe"
        }
      });
      
      // Capturar coordenada actual inicial de inmediato
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
        if (loc) {
          const newPoint = {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            timestamp: loc.timestamp,
            accuracy: loc.coords.accuracy
          };
          const existingTrackStr = await AsyncStorage.getItem('@gps_track');
          const existingTrack = existingTrackStr ? JSON.parse(existingTrackStr) : [];
          const updatedTrack = [...existingTrack, newPoint];
          await AsyncStorage.setItem('@gps_track', JSON.stringify(updatedTrack));
        }
      } catch (gpsErr) {
        console.warn("No se pudo obtener la posición GPS inicial:", gpsErr);
      }
      
      setIsTracking(true);
      setLaborActive(true);
      
      const typedUser = await AsyncStorage.getItem('@logged_user');
      await AsyncStorage.setItem('@labor_active_' + typedUser, 'true');
      if (selectedForm) {
        await AsyncStorage.setItem('@active_form_id_' + typedUser, selectedForm.id);
      }
      
      triggerToast("✓ Labor iniciada");
    } catch (e) {
      console.error("Error al iniciar la labor:", e);
      Alert.alert("Error", "No se pudo iniciar el servicio de labor.");
    }
  };

  // Detener Labor / Tracking GPS
  const handleStopLabor = () => {
    Alert.alert(
      "Finalizar labor",
      "¿Estás seguro de que deseas finalizar la labor de hoy? Esto guardará la información y limpiará los campos.",
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: "Finalizar Labor", 
          onPress: async () => {
            try {
              const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
              if (running) {
                await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
              }
              setIsTracking(false);
              setLaborActive(false);

              const typedUser = await AsyncStorage.getItem('@logged_user');
              await AsyncStorage.setItem('@labor_active_' + typedUser, 'false');
              await AsyncStorage.setItem('@active_form_id_' + typedUser, '');
              
              // Limpiar campos no fijados
              const newValues = {};
              if (selectedForm) {
                (selectedForm.fields || []).forEach(f => {
                  if (pinnedFields[f.id]) {
                    newValues[f.id] = formValues[f.id]; // Mantener valor fijado
                  } else {
                    newValues[f.id] = ''; // Vaciar
                  }
                });
              }
              setFormValues(newValues);
              await AsyncStorage.setItem('@form_values_' + typedUser, JSON.stringify(newValues));

              Alert.alert("Labor Finalizada", "Se ha cerrado la labor y se han limpiado los campos.");
            } catch (e) {
              console.error("Error al finalizar labor:", e);
            }
          }, 
          style: "destructive" 
        }
      ]
    );
  };

  // Manejar cambio en un campo dinámico
  const handleFieldChange = async (fieldId, value) => {
    const nextValues = { ...formValues, [fieldId]: value };
    setFormValues(nextValues);
    const typedUser = await AsyncStorage.getItem('@logged_user');
    await AsyncStorage.setItem('@form_values_' + typedUser, JSON.stringify(nextValues));
  };

  // Alternar el estado de fijar (pin) un campo
  const togglePinField = async (fieldId) => {
    const nextPinned = { ...pinnedFields, [fieldId]: !pinnedFields[fieldId] };
    setPinnedFields(nextPinned);
    const typedUser = await AsyncStorage.getItem('@logged_user');
    await AsyncStorage.setItem('@pinned_fields_' + typedUser, JSON.stringify(nextPinned));
  };

  // Guardar Formulario Localmente
  const handleSaveForm = async () => {
    if (!selectedForm) return;

    // Validar requeridos
    let missingRequired = false;
    (selectedForm.fields || []).forEach(f => {
      if (f.required) {
        const val = formValues[f.id];
        if (!val || String(val).trim() === '') {
          missingRequired = true;
        }
      }
    });

    if (missingRequired) {
      Alert.alert("Campos requeridos", "Por favor completa todos los campos marcados con asterisco (*).");
      return;
    }

    try {
      // Capturar coordenada GPS actual
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

      const loggedUser = await AsyncStorage.getItem('@logged_user') || 'admin';
      
      // Construir registro dinámico plano
      const formRecord = {
        id: 'form-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        usuario: loggedUser,
        formulario_id: selectedForm.id,
        timestamp: Date.now(),
        gps: currentCoords
      };

      // Inyectar respuestas en el primer nivel del objeto para compatibilidad web
      (selectedForm.fields || []).forEach(f => {
        formRecord[f.id] = String(formValues[f.id] || '').trim();
      });

      // Cargar cola de formularios locales
      const formsStr = await AsyncStorage.getItem('@forms_data');
      const forms = formsStr ? JSON.parse(formsStr) : [];
      forms.push(formRecord);

      // Guardar en AsyncStorage
      await AsyncStorage.setItem('@forms_data', JSON.stringify(forms));

      // Limpieza de campos no fijados
      const nextValues = { ...formValues };
      (selectedForm.fields || []).forEach(f => {
        if (!pinnedFields[f.id]) {
          nextValues[f.id] = '';
        }
      });
      setFormValues(nextValues);
      await AsyncStorage.setItem('@form_values_' + loggedUser, JSON.stringify(nextValues));

      triggerToast("✓ Registro guardado localmente");
      updateLocalStats();
    } catch (e) {
      console.error("Error al guardar el formulario:", e);
      Alert.alert("Error", "Ocurrió un error al guardar los datos localmente.");
    }
  };

  // Sincronizar todos los datos acumulados con Firebase Cloud
  const handleSyncData = async () => {
    setSyncing(true);
    try {
      const loggedUser = await AsyncStorage.getItem('@logged_user') || 'admin';
      
      // Intentar descargar la última configuración de formularios asignados
      await syncAssignedFormsFromServer(loggedUser);

      // 1. Sincronizar Formularios de Campo
      const formsStr = await AsyncStorage.getItem('@forms_data');
      const forms = formsStr ? JSON.parse(formsStr) : [];

      if (forms.length > 0) {
        for (const item of forms) {
          await fetch(FIREBASE_DB_URL + '/registros/lecturas_campo/' + item.id + '.json', {
            method: 'PUT',
            body: JSON.stringify(item)
          });
        }
      }

      // 2. Sincronizar Puntos GPS de Recorridos
      const trackStr = await AsyncStorage.getItem('@gps_track');
      const track = trackStr ? JSON.parse(trackStr) : [];

      if (track.length > 0) {
        const trackId = 'track-' + Date.now();
        await fetch(FIREBASE_DB_URL + '/registros/campo_recorridos/' + trackId + '.json', {
          method: 'PUT',
          body: JSON.stringify({
            id: trackId,
            usuario: loggedUser,
            timestamp: Date.now(),
            recorrido: track
          })
        });
      }

      // Limpiar AsyncStorage local si hubo envíos
      if (forms.length > 0) {
        await AsyncStorage.setItem('@forms_data', JSON.stringify([]));
      }
      if (track.length > 0) {
        await AsyncStorage.setItem('@gps_track', JSON.stringify([]));
      }

      Alert.alert("Sincronización Exitosa", "Toda la información del día y los formularios se han actualizado con éxito.");
      updateLocalStats();
    } catch (err) {
      console.error("Error al sincronizar con Firebase:", err);
      Alert.alert("Fallo de sincronización", "Ocurrió un error al subir los datos. Asegúrate de tener conexión a internet estable.");
    } finally {
      setSyncing(false);
    }
  };

  // Cerrar Sesión (Salir)
  const handleLogout = async () => {
    if (laborActive) {
      Alert.alert("Labor activa", "No puedes cerrar sesión mientras la labor esté activa. Finaliza la labor primero.");
      return;
    }
    Alert.alert(
      "Cerrar sesión",
      "¿Deseas cerrar sesión en esta unidad?",
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: "Cerrar Sesión", 
          onPress: async () => {
            const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
            if (running) {
              await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
            }
            setIsTracking(false);
            setLaborActive(false);
            setSelectedForm(null);
            setAssignedForms([]);
            await AsyncStorage.setItem('@is_logged_in', 'false');
            setIsLoggedIn(false);
          }, 
          style: "destructive" 
        }
      ]
    );
  };

  // Retornar color del punto de estado GPS
  const getGpsDotColor = () => {
    if (gpsError) return '#ff4b4b'; // Rojo: error o sin permisos
    if (isTracking) return '#00e676'; // Verde: activo
    return '#ff9100'; // Naranja: inactivo
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
          <Text style={styles.authSubtitle}>Captura y Gestión de Datos de Campo</Text>

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
      
      {/* Cabecera Fija */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={[styles.dotIndicator, { backgroundColor: getGpsDotColor() }]} />
          <Text style={styles.headerTitle}>GAHLG Campo</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Contenido Principal según la pestaña */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {currentTab === 'datos' ? (
          <View style={styles.tabView}>
            
            {/* CASO A: Selector de formularios si hay más de 1 asignado y no hay labor activa */}
            {assignedForms.length > 1 && !selectedForm && (
              <View>
                <Text style={styles.sectionTitle}>Seleccione una labor</Text>
                {assignedForms.map(form => (
                  <TouchableOpacity 
                    key={form.id} 
                    style={styles.formSelectBtn}
                    onPress={() => {
                      setSelectedForm(form);
                      // Inicializar formValues con campos vacíos
                      const initialValues = {};
                      (form.fields || []).forEach(f => {
                        initialValues[f.id] = '';
                      });
                      setFormValues(initialValues);
                    }}
                  >
                    <Text style={styles.formSelectBtnText}>{form.titulo}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* CASO B: Sin formularios asignados (Rastreo por Defecto) */}
            {assignedForms.length === 0 && (
              <View style={styles.centerBox}>
                <Text style={styles.sectionTitle}>Registro de Labor</Text>
                <Text style={styles.helpText}>Esta cuenta no tiene formularios asignados. Utiliza los botones inferiores para registrar tu labor.</Text>
                
                {!laborActive ? (
                  <TouchableOpacity style={styles.startLaborBtn} onPress={handleStartLabor}>
                    <Text style={styles.startLaborBtnText}>Iniciar Labor</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.stopDayBtn} onPress={handleStopLabor}>
                    <Text style={styles.stopDayBtnText}>Finalizar Labor</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* CASO C: Formulario seleccionado o asignado por defecto */}
            {selectedForm && (
              <View>
                <View style={{ marginBottom: 20 }}>
                  <Text style={styles.sectionTitle}>{selectedForm.titulo}</Text>
                  {/* Botón de volver al selector si tiene más de 1 y la labor no ha iniciado */}
                  {assignedForms.length > 1 && !laborActive && (
                    <TouchableOpacity 
                      style={[styles.pinBtn, { marginTop: 8, alignSelf: 'flex-start' }]} 
                      onPress={() => setSelectedForm(null)}
                    >
                      <Text style={styles.pinBtnText}>← Cambiar Labor</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Si la labor no ha iniciado, solo se muestra el botón de Iniciar Labor */}
                {!laborActive ? (
                  <View style={styles.centerBox}>
                    <Text style={styles.helpText}>Para comenzar a registrar las lecturas en campo, inicia la labor de hoy.</Text>
                    <TouchableOpacity style={styles.startLaborBtn} onPress={handleStartLabor}>
                      <Text style={styles.startLaborBtnText}>
                        {selectedForm.labels?.iniciar || 'Iniciar Labor'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  // Si la labor está activa, se dibuja todo el formulario y sus campos dinámicos
                  <View>
                    {(selectedForm.fields || []).map(field => {
                      const isPinned = !!pinnedFields[field.id];
                      
                      return (
                        <View key={field.id} style={styles.fieldContainer}>
                          <View style={styles.fieldLabelRow}>
                            <Text style={styles.fieldLabel}>
                              {field.label} {field.required ? '*' : ''}
                            </Text>
                            {/* Mostrar botón de fijar (candado) únicamente si el campo lo permite en la configuración */}
                            {field.pinned !== false && (
                              <TouchableOpacity 
                                style={[styles.pinBtn, isPinned && styles.pinBtnActive]} 
                                onPress={() => togglePinField(field.id)}
                              >
                                <Text style={styles.pinBtnText}>{isPinned ? '🔒 Fijado' : '🔓 Fijar'}</Text>
                              </TouchableOpacity>
                            )}
                          </View>

                          {/* Tipo: select (Opciones en botones horizontales) */}
                          {field.type === 'select' ? (
                            <View style={styles.fincaButtonGroup}>
                              {(field.options || []).map(opt => {
                                const isActive = formValues[field.id] === opt;
                                return (
                                  <TouchableOpacity
                                    key={opt}
                                    style={[styles.fincaOption, isActive && styles.fincaOptionActive]}
                                    onPress={() => handleFieldChange(field.id, opt)}
                                  >
                                    <Text style={[styles.fincaOptionText, isActive && styles.fincaOptionTextActive]}>
                                      {opt}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          ) : field.type === 'checkbox' ? (
                            // Tipo: checkbox (Casilla de verificación / Checklist)
                            <View style={{ gap: 8, marginVertical: 4 }}>
                              {(field.options && field.options.length > 0) ? (
                                // Lista de opciones múltiples
                                field.options.map(opt => {
                                  const currentVal = formValues[field.id] || '';
                                  const selectedOpts = currentVal ? currentVal.split(',').map(s => s.trim()) : [];
                                  const isChecked = selectedOpts.includes(opt);
                                  
                                  return (
                                    <TouchableOpacity
                                      key={opt}
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 10,
                                        backgroundColor: isChecked ? 'rgba(0, 242, 254, 0.1)' : '#0c0f1a',
                                        borderWidth: 1,
                                        borderColor: isChecked ? '#00f2fe' : 'rgba(255,255,255,0.05)',
                                        borderRadius: 8,
                                        padding: 12
                                      }}
                                      onPress={() => {
                                        let nextOpts;
                                        if (isChecked) {
                                          nextOpts = selectedOpts.filter(o => o !== opt);
                                        } else {
                                          nextOpts = [...selectedOpts, opt];
                                        }
                                        handleFieldChange(field.id, nextOpts.join(', '));
                                      }}
                                    >
                                      <View style={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: 4,
                                        borderWidth: 1,
                                        borderColor: isChecked ? '#00f2fe' : '#a0aec0',
                                        backgroundColor: isChecked ? '#00f2fe' : 'transparent',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}>
                                        {isChecked && (
                                          <Text style={{ color: '#0c0f1a', fontWeight: 'bold', fontSize: 11 }}>✓</Text>
                                        )}
                                      </View>
                                      <Text style={{ color: '#ffffff', fontSize: 14 }}>{opt}</Text>
                                    </TouchableOpacity>
                                  );
                                })
                              ) : (
                                // Casilla única Sí/No
                                <TouchableOpacity
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 10,
                                    backgroundColor: formValues[field.id] === 'Sí' ? 'rgba(0, 242, 254, 0.1)' : '#0c0f1a',
                                    borderWidth: 1,
                                    borderColor: formValues[field.id] === 'Sí' ? '#00f2fe' : 'rgba(255,255,255,0.05)',
                                    borderRadius: 8,
                                    padding: 14
                                  }}
                                  onPress={() => handleFieldChange(field.id, formValues[field.id] === 'Sí' ? 'No' : 'Sí')}
                                >
                                  <View style={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: 4,
                                    borderWidth: 1,
                                    borderColor: formValues[field.id] === 'Sí' ? '#00f2fe' : '#a0aec0',
                                    backgroundColor: formValues[field.id] === 'Sí' ? '#00f2fe' : 'transparent',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}>
                                    {formValues[field.id] === 'Sí' && (
                                      <Text style={{ color: '#0c0f1a', fontWeight: 'bold', fontSize: 13 }}>✓</Text>
                                    )}
                                  </View>
                                  <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '500' }}>
                                    Marcar/Chulear esta opción
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          ) : field.type === 'textarea' ? (
                            // Tipo: textarea (observaciones multilínea)
                            <TextInput
                              style={[styles.fieldInput, { height: 80, textAlignVertical: 'top' }]}
                              placeholder={'Escribe la ' + field.label.toLowerCase() + '...'}
                              placeholderTextColor="#636b77"
                              value={formValues[field.id] || ''}
                              onChangeText={(val) => handleFieldChange(field.id, val)}
                              multiline
                            />
                          ) : (
                            // Tipo estándar (text / number)
                            <TextInput
                              style={styles.fieldInput}
                              placeholder={field.label}
                              placeholderTextColor="#636b77"
                              value={formValues[field.id] || ''}
                              onChangeText={(val) => handleFieldChange(field.id, val)}
                              keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                            />
                          )}
                        </View>
                      );
                    })}

                    {/* Acciones de guardar e ir al final de la labor */}
                    {selectedForm.fields && selectedForm.fields.length > 0 && (
                      <TouchableOpacity style={styles.submitBtn} onPress={handleSaveForm}>
                        <Text style={styles.submitBtnText}>Enviar Registro</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity style={styles.stopDayBtn} onPress={handleStopLabor}>
                      <Text style={styles.stopDayBtnText}>
                        {selectedForm.labels?.finalizar || 'Finalizar Labor'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

          </View>
        ) : (
          /* TAB DE SINCRONIZACIÓN SIMPLIFICADA (Conteo de GPS y botón fijo) */
          <View style={styles.tabView}>
            <Text style={styles.sectionTitle}>Sincronización en la Nube</Text>
            
            <View style={styles.syncCard}>
              <Text style={styles.syncCardTitle}>Datos Pendientes de Subida</Text>
              
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Información del día:</Text>
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
              Al presionar "Sincronizar", se conectará a Firebase Realtime Database para cargar toda la información recolectada durante el día.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Barra de Navegación Inferior (Tabs Fijos) */}
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dotIndicator: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
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
  },
  formHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },

  // Botones de Selector de Formulario
  formSelectBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 20,
    marginVertical: 8,
    alignItems: 'center',
  },
  formSelectBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Cajas e Indicaciones
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    backgroundColor: 'rgba(255,255,255,0.01)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    marginVertical: 10,
  },
  helpText: {
    color: '#cbd5e0',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 25,
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

  // finca select button group
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
  startLaborBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 30,
    alignItems: 'center',
    shadowColor: '#00f2fe',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
    width: '100%',
  },
  startLaborBtnText: {
    color: '#051829',
    fontSize: 16,
    fontWeight: 'bold',
  },
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
