import { rtdb } from '../firebaseConfig';
import { ref, update, get, child, set } from 'firebase/database';

/**
 * Sube registros en lotes de 1,000 elementos a Firebase Realtime Database usando la conexión pre-configurada.
 * @param {Array<Object>} records - Listado completo de registros.
 * @param {Function} onProgress - Callback para reportar el avance.
 * @returns {Promise<void>}
 */
export async function uploadRecords(records, onProgress) {
  const dbRef = ref(rtdb);
  const total = records.length;
  const chunkSize = 1000;
  let processed = 0;

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const updates = {};

    chunk.forEach(record => {
      // Filtrar y limpiar propiedades computadas para ahorrar ancho de banda
      updates[`/registros/${record.id}`] = {
        id: record.id,
        semana: record.semana,
        finca: record.finca,
        pluviometro: record.pluviometro,
        anio: record.anio,
        mesDesc: record.mesDesc,
        dia: record.dia,
        prec: record.prec,
        mes: record.mes,
        data: record.data
      };
    });

    try {
      await update(dbRef, updates);
      processed += chunk.length;
      if (onProgress) {
        onProgress(processed, total);
      }
    } catch (error) {
      throw new Error(`Error subiendo lote desde registro ${i}: ` + error.message);
    }
  }
}

/**
 * Descarga todos los registros históricos almacenados en Firebase Realtime Database.
 * @returns {Promise<Array<Object>>} Listado de registros.
 */
export async function downloadRecords() {
  const dbRef = ref(rtdb);
  try {
    const snapshot = await get(child(dbRef, 'registros'));
    if (snapshot.exists()) {
      const val = snapshot.val();
      if (val) {
        // Firebase puede retornar un objeto o un array indexado si los ids tienen patrones específicos
        return Object.values(val);
      }
    }
    return [];
  } catch (error) {
    throw new Error("Error al descargar desde Firebase: " + error.message);
  }
}

/**
 * Sube un mapa GeoJSON para una finca específica a Firebase.
 * @param {string} fincaId - ID o código de la finca.
 * @param {Object} geojsonData - Objeto GeoJSON.
 * @returns {Promise<void>}
 */
export async function uploadMap(fincaId, geojsonData) {
  const dbRef = ref(rtdb);
  try {
    const mapNodeRef = child(dbRef, `maps/${fincaId}`);
    await set(mapNodeRef, {
      fincaId,
      geojson: JSON.stringify(geojsonData),
      updatedAt: Date.now()
    });
  } catch (error) {
    throw new Error(`Error al subir el mapa de la finca ${fincaId} a Firebase: ` + error.message);
  }
}

/**
 * Descarga todos los mapas geográficos de Firebase.
 * @returns {Promise<Array<Object>>} Lista de objetos de mapas con fincaId y geojson.
 */
export async function downloadMaps() {
  const dbRef = ref(rtdb);
  try {
    const snapshot = await get(child(dbRef, 'maps'));
    if (snapshot.exists()) {
      const val = snapshot.val();
      if (val) {
        return Object.values(val).map(item => ({
          fincaId: item.fincaId,
          geojson: typeof item.geojson === 'string' ? JSON.parse(item.geojson) : item.geojson,
          updatedAt: item.updatedAt
        }));
      }
    }
    return [];
  } catch (error) {
    throw new Error("Error al descargar mapas desde Firebase: " + error.message);
  }
}

/**
 * Sube registros de suelos en lotes a Firebase Realtime Database.
 * @param {Array<Object>} records - Listado de registros de suelos.
 * @param {Function} onProgress - Callback para reportar el avance.
 * @returns {Promise<void>}
 */
export async function uploadSoilRecords(records, onProgress) {
  const dbRef = ref(rtdb);
  const total = records.length;
  const chunkSize = 500; // Un lote más pequeño para suelos es adecuado
  let processed = 0;

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const updates = {};

    chunk.forEach(record => {
      // Sube todo el objeto del suelo tal como venga parseado
      updates[`/suelos/${record.id}`] = record;
    });

    try {
      await update(dbRef, updates);
      processed += chunk.length;
      if (onProgress) {
        onProgress(processed, total);
      }
    } catch (error) {
      throw new Error(`Error subiendo lote de suelos desde registro ${i}: ` + error.message);
    }
  }
}

/**
 * Descarga todos los registros de suelos almacenados en Firebase Realtime Database.
 * @returns {Promise<Array<Object>>} Listado de registros de suelo.
 */
export async function downloadSoilRecords() {
  const dbRef = ref(rtdb);
  try {
    const snapshot = await get(child(dbRef, 'suelos'));
    if (snapshot.exists()) {
      const val = snapshot.val();
      if (val) {
        return Object.values(val);
      }
    }
    return [];
  } catch (error) {
    throw new Error("Error al descargar suelos desde Firebase: " + error.message);
  }
}

/**
 * Obtiene las credenciales de acceso de administrador desde Firebase Realtime Database.
 * @returns {Promise<Object|null>}
 */
export async function getAdminCredentials() {
  const dbRef = ref(rtdb);
  try {
    const snapshot = await get(child(dbRef, 'admin_auth'));
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (error) {
    console.error("Error al descargar credenciales de administrador:", error);
    return null;
  }
}
