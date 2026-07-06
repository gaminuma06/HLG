const DB_NAME = 'GHLG_Balance_DB';
const DB_VERSION = 2;
const STORE_NAME = 'records';
const MAPS_STORE_NAME = 'maps';

/**
 * Inicializa la base de datos IndexedDB.
 * @returns {Promise<IDBDatabase>} Promesa que resuelve a la instancia de la base de datos.
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MAPS_STORE_NAME)) {
        db.createObjectStore(MAPS_STORE_NAME, { keyPath: 'fincaId' });
      }
    };

    request.onsuccess = (e) => {
      resolve(e.target.result);
    };

    request.onerror = (e) => {
      reject(new Error("Error abriendo IndexedDB: " + e.target.error.message));
    };
  });
}

/**
 * Guarda todos los registros en IndexedDB.
 * @param {Array<Object>} records - Lista de registros a guardar.
 * @returns {Promise<void>} Promesa vacía cuando finaliza la escritura.
 */
export function saveHistoricalRecords(records) {
  return initDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // Primero limpiamos el almacén
      const clearRequest = store.clear();

      clearRequest.onsuccess = () => {
        // Subida masiva rápida en una sola transacción
        let index = 0;
        
        function putNext() {
          if (index < records.length) {
            const req = store.add(records[index]);
            req.onsuccess = () => {
              index++;
              putNext();
            };
            req.onerror = (err) => {
              transaction.abort();
              reject(new Error("Error al insertar registro en índice " + index + ": " + err.target.error.message));
            };
          } else {
            resolve();
          }
        }
        
        putNext();
      };

      clearRequest.onerror = (err) => {
        reject(new Error("Error al limpiar IndexedDB: " + err.target.error.message));
      };
    });
  });
}

/**
 * Carga todos los registros guardados en IndexedDB.
 * @returns {Promise<Array<Object>>} Promesa que resuelve al listado de registros.
 */
export function loadHistoricalRecords() {
  return initDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = (e) => {
        resolve(e.target.result || []);
      };

      request.onerror = (e) => {
        reject(new Error("Error al leer datos de IndexedDB: " + e.target.error.message));
      };
    });
  });
}

/**
 * Elimina todos los registros de IndexedDB.
 * @returns {Promise<void>} Promesa vacía cuando finaliza la eliminación.
 */
export function clearHistoricalRecords() {
  return initDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (e) => {
        reject(new Error("Error al vaciar IndexedDB: " + e.target.error.message));
      };
    });
  });
}

/**
 * Guarda un mapa GeoJSON para una finca específica.
 * @param {string} fincaId - ID de la finca (ej. '01', 'HLG', etc.)
 * @param {Object} geojsonData - Datos del mapa en formato GeoJSON
 * @returns {Promise<void>}
 */
export function saveLocalMap(fincaId, geojsonData) {
  return initDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MAPS_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(MAPS_STORE_NAME);
      const request = store.put({ fincaId, geojson: geojsonData, updatedAt: Date.now() });

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (err) => {
        reject(new Error("Error al guardar mapa localmente: " + err.target.error.message));
      };
    });
  });
}

/**
 * Obtiene el mapa GeoJSON de una finca.
 * @param {string} fincaId - ID de la finca (ej. '01', 'HLG', etc.)
 * @returns {Promise<Object|null>} Promesa que resuelve al objeto del mapa o null si no existe.
 */
export function getLocalMap(fincaId) {
  return initDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MAPS_STORE_NAME], 'readonly');
      const store = transaction.objectStore(MAPS_STORE_NAME);
      const request = store.get(fincaId);

      request.onsuccess = (e) => {
        resolve(e.target.result ? e.target.result.geojson : null);
      };

      request.onerror = (err) => {
        reject(new Error("Error al obtener mapa local: " + err.target.error.message));
      };
    });
  });
}

/**
 * Elimina todos los mapas almacenados localmente.
 * @returns {Promise<void>}
 */
export function clearLocalMaps() {
  return initDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MAPS_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(MAPS_STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (e) => {
        reject(new Error("Error al limpiar mapas locales: " + e.target.error.message));
      };
    });
  });
}
