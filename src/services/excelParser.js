import * as XLSX from 'xlsx';

/**
 * Normaliza las claves de un objeto para ignorar mayúsculas/minúsculas y acentos.
 * @param {Object} obj - Fila original de Excel.
 * @returns {Object} Fila mapeada con claves normalizadas.
 */
function normalizeKeys(obj) {
  const normalized = {};
  for (const key of Object.keys(obj)) {
    const normKey = key
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); // Remueve acentos
    normalized[normKey] = obj[key];
  }
  return normalized;
}

/**
 * Lee un archivo Excel y devuelve una lista de registros con claves consistentes.
 * @param {File} file - El archivo Excel subido mediante input.
 * @returns {Promise<Array<Object>>} Promesa que resuelve a un array de registros procesados.
 */
export function parseHistoricalExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Asumimos que los datos están en la primera hoja
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convertir a JSON
        const rawJson = XLSX.utils.sheet_to_json(worksheet);
        
        // Mapear y tipar los datos
        const processedRecords = rawJson.map((row, index) => {
          const normRow = normalizeKeys(row);
          
          // Valores por defecto y casteo
          const semana = parseInt(normRow['semana'] || 0, 10);
          let finca = String(normRow['finca'] || '').trim().padStart(2, '0'); // Formato '01', '02', etc.
          const pluviometro = String(normRow['pluviometro'] || '').trim();
          
          // Corrección: El Rodeo pertenece a la Finca 3 (TUC - "03")
          const pluvLower = pluviometro.toLowerCase();
          if (pluvLower === 'el rodeo' || pluvLower === 'rodeo') {
            finca = '03';
          }
          const anio = parseInt(normRow['ano'] || normRow['anio'] || 0, 10);
          const mesDesc = String(normRow['mes_desc'] || normRow['mesdesc'] || '').trim();
          const dia = parseInt(normRow['dia'] || 0, 10);
          const prec = parseFloat(normRow['prec'] || normRow['precipitacion'] || 0);
          const mes = parseInt(normRow['mes'] || 0, 10);
          
          // Formatear o extraer la fecha completa
          let fechaStr = normRow['data'] || normRow['fecha'] || '';
          if (fechaStr instanceof Date) {
            fechaStr = fechaStr.toLocaleDateString('es-ES');
          } else if (typeof fechaStr === 'number') {
            // Excel almacena fechas como números seriales a veces
            const excelDate = new Date((fechaStr - (25567 + 2)) * 86400 * 1000);
            fechaStr = excelDate.toLocaleDateString('es-ES');
          } else {
            fechaStr = String(fechaStr).trim();
          }

          return {
            id: `row-${index}-${Date.now()}`,
            semana,
            finca,
            pluviometro,
            anio,
            mesDesc,
            dia,
            prec,
            mes,
            data: fechaStr || `${dia.toString().padStart(2, '0')}/${mes.toString().padStart(2, '0')}/${anio}`
          };
        });

        // Filtrar registros inválidos (que no tengan finca o fecha mínima)
        const validRecords = processedRecords.filter(r => r.finca !== '00' && r.anio > 0);

        resolve(validRecords);
      } catch (error) {
        reject(new Error("Error al procesar el archivo Excel. Verifica el formato. Detalle: " + error.message));
      }
    };

    reader.onerror = () => {
      reject(new Error("Error al leer el archivo."));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Calcula el balance hídrico simple por día/semana basado en registros históricos de precipitación.
 * Por ahora usa una evapotranspiración referencial (ET) estimada diaria (ej. 3.5 mm/día).
 * @param {Array<Object>} records - Registros filtrados de precipitación.
 * @param {number} etReferencial - Evapotranspiración diaria de diseño en mm (por defecto 3.5 mm).
 * @param {number} capacidadSuelo - Capacidad máxima de almacenamiento de agua útil del suelo (ej. 80 mm).
 * @returns {Array<Object>} Registros con el cálculo del balance acumulado.
 */
export function calculateWaterBalance(records, etReferencial = 3.5, capacidadSuelo = 80) {
  // Ordenar registros por fecha
  const sortedRecords = [...records].sort((a, b) => {
    const parseDate = (dStr) => {
      const parts = dStr.split('/');
      return new Date(parts[2], parts[1] - 1, parts[0]);
    };
    return parseDate(a.data) - parseDate(b.data);
  });

  let balanceAcumulado = capacidadSuelo; // Comenzamos con suelo lleno a capacidad de campo como estimación inicial
  
  return sortedRecords.map(record => {
    const prec = record.prec;
    
    // Balance diario: Precipitación - Evapotranspiración
    const balanceDiario = prec - etReferencial;
    
    // Calcular nueva reserva del suelo
    let nuevoBalance = balanceAcumulado + balanceDiario;
    
    // Límites de la reserva (entre 0 y la capacidad máxima)
    let escurrimiento = 0;
    let deficit = 0;

    if (nuevoBalance > capacidadSuelo) {
      escurrimiento = nuevoBalance - capacidadSuelo;
      nuevoBalance = capacidadSuelo;
    } else if (nuevoBalance < 0) {
      deficit = Math.abs(nuevoBalance);
      nuevoBalance = 0;
    }

    balanceAcumulado = nuevoBalance;

    return {
      ...record,
      etReferencial,
      balanceDiario,
      balanceAcumulado,
      escurrimiento,
      deficit
    };
  });
}

/**
 * Lee un archivo Excel de suelos y devuelve una lista de registros con claves normalizadas.
 * @param {File} file - El archivo Excel subido.
 * @returns {Promise<Array<Object>>}
 */
export function parseSoilsExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rawJson = XLSX.utils.sheet_to_json(worksheet);
        
        const processedRecords = rawJson.map((row, index) => {
          const normRow = normalizeKeys(row);
          
          // Generamos un id determinístico o único
          return {
            id: `soil-row-${index}-${Date.now()}`,
            ...normRow
          };
        });

        resolve(processedRecords);
      } catch (error) {
        reject(new Error("Error al procesar el archivo de suelos Excel: " + error.message));
      }
    };

    reader.onerror = () => {
      reject(new Error("Error al leer el archivo de suelos."));
    };

    reader.readAsArrayBuffer(file);
  });
}
