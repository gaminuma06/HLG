import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import anime from 'animejs/lib/anime.es.js';
import { 
  Upload, 
  Droplet, 
  CloudRain, 
  Database, 
  AlertTriangle, 
  Trash2, 
  Calendar, 
  MapPin, 
  TrendingDown, 
  Layers,
  TrendingUp,
  Info,
  CloudLightning,
  CheckCircle2,
  RefreshCw,
  Server,
  Settings,
  X,
  BarChart2,
  LineChart,
  Sun,
  Search,
  Download,
  Palette,
  Compass,
  ArrowLeft,
  Play,
  Pause
} from 'lucide-react';
import * as XLSX from 'xlsx';
import 'leaflet/dist/leaflet.css';
import { parseHistoricalExcel, calculateWaterBalance, parseSoilsExcel } from './services/excelParser';
import { saveHistoricalRecords, loadHistoricalRecords, clearHistoricalRecords, getLocalMap, saveLocalMap, saveSoilRecords, loadSoilRecords, clearSoilRecords } from './services/dbStore';
import { uploadRecords, downloadRecords, uploadMap, downloadMaps, uploadSoilRecords, downloadSoilRecords, getAdminCredentials, downloadMobileTracks, downloadMobileReadings } from './services/firebaseService';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, LineController, BarController, Filler } from 'chart.js';
import L from 'leaflet';
import { Chart } from 'react-chartjs-2';
import { MapContainer, TileLayer, GeoJSON as LeafletGeoJSON, Tooltip as LeafletTooltip, Marker as LeafletMarker, CircleMarker as LeafletCircleMarker, useMap, Polyline, ZoomControl } from 'react-leaflet';
import html2canvas from 'html2canvas';
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  BarController,
  Filler
);

const customDataLabelsPlugin = {
  id: 'customDataLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.omitLabels) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      
      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined) return;
        
        const formattedValue = typeof value === 'number' ? Math.round(value) : value;
        if (dataset.type === 'bar' && formattedValue === 0) return; // omit zero values on bars
        
        const x = element.x;
        const y = element.y;
        
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        
        if (dataset.type === 'bar') {
          // Obtener la base del eje Y para calcular de forma precisa la altura de la barra en Chart.js v4
          const base = typeof element.base === 'number' ? element.base : chart.scales.y.getPixelForValue(0);
          const barHeight = base - y;
          
          if (barHeight > 20) {
            ctx.fillStyle = '#051829'; // Azul muy oscuro para alto contraste dentro de las barras claras
            ctx.fillText(formattedValue, x, base - 10); // Dibujado cerca de la base para evitar colisiones con la línea
          } else {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 3;
            ctx.strokeStyle = dataset.borderColor || '#00f2fe'; // Contorno
            ctx.lineWidth = 2;
            ctx.strokeText(formattedValue, x, y - 6);
            ctx.shadowBlur = 0; // reset
            ctx.fillStyle = '#ffffff'; // relleno blanco
            ctx.fillText(formattedValue, x, y - 6);
          }
        } else if (dataset.type === 'line') {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
          ctx.shadowBlur = 3;
          ctx.strokeStyle = dataset.borderColor || '#ff4b4b'; // Contorno
          ctx.lineWidth = 2.5;
          ctx.strokeText(formattedValue, x, y - 12); // Dibujado más arriba para evitar solapamientos
          ctx.shadowBlur = 0; // reset
          ctx.fillStyle = '#ffffff'; // relleno blanco
          ctx.fillText(formattedValue, x, y - 12);
        }
      });
    });
    ctx.restore();
  }
  };

const horizontalLinePlugin = {
  id: 'horizontalLine',
  afterDatasetsDraw(chart, args, options) {
    if (options && typeof options.yValue === 'number') {
      const { ctx, chartArea: { left, right }, scales: { y } } = chart;
      const yPixel = y.getPixelForValue(options.yValue);
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = options.borderColor || '#ffd600';
      ctx.lineWidth = options.borderWidth || 2.5;
      ctx.moveTo(left, yPixel);
      ctx.lineTo(right, yPixel);
      ctx.stroke();

      if (options.label) {
        ctx.fillStyle = options.labelColor || 'rgba(255, 255, 255, 0.55)';
        ctx.font = options.labelFont || 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(options.label, right - 8, yPixel - 3);
      }

      ctx.restore();
    }
  }
};

const FINCA_NAMES = {
  '01': 'HLG',
  '02': 'HSL',
  '03': 'TUC'
};

const FINCA_MAPS_KEYS = {
  '01': 'HLG',
  '02': 'HSL',
  '03': 'TUC',
  'HLG': 'HLG',
  'HSL': 'HSL',
  'TUC': 'TUC'
};

const REVERSE_FINCA_MAPS_KEYS = {
  'HLG': '01',
  'HSL': '02',
  'TUC': '03'
};

const KC_ETAPAS = [
  { etapa: 'Vivero / Establecimiento', edadMin: 0,  edadMax: 1,  kc: 0.75 },
  { etapa: 'Juvenil I',                edadMin: 1,  edadMax: 2,  kc: 0.85 },
  { etapa: 'Juvenil II',               edadMin: 2,  edadMax: 3,  kc: 0.95 },
  { etapa: 'Producción Inicial',       edadMin: 3,  edadMax: 6,  kc: 1.00 },
  { etapa: 'Producción Plena',         edadMin: 6,  edadMax: 20, kc: 1.05 },
  { etapa: 'Producción Madura',        edadMin: 20, edadMax: 25, kc: 1.00 },
  { etapa: 'Senescencia / Replante',   edadMin: 25, edadMax: 99, kc: 0.90 },
];

const ESTRES_NIVELES = [
  { label: 'Óptimo',        pctMin: 60,  pctMax: 101, color: '#00c853', colorAlpha: 'rgba(0, 200, 83, 0.18)',   icon: '🟢' },
  { label: 'Atención',      pctMin: 30,  pctMax: 60,  color: '#ffd600', colorAlpha: 'rgba(255, 214, 0, 0.18)',  icon: '🟡' },
  { label: 'Estrés',        pctMin: 10,  pctMax: 30,  color: '#ff4b4b', colorAlpha: 'rgba(255, 75, 75, 0.18)',  icon: '🔴' },
  { label: 'Estrés Severo', pctMin: 0,   pctMax: 10,  color: '#c800ff', colorAlpha: 'rgba(200, 0, 255, 0.18)', icon: '🟣' },
];

const getNivelEstres = (reserva, capacidadSuelo) => {
  const pct = capacidadSuelo > 0 ? (reserva / capacidadSuelo) * 100 : 0;
  return ESTRES_NIVELES.find(n => pct >= n.pctMin && pct < n.pctMax) || ESTRES_NIVELES[3];
};

const FERTILIZACION_NIVELES = {
  viable: { label: 'Viable', color: '#00e676', description: 'Humedad óptima para disolución', colorAlpha: 'rgba(0, 230, 118, 0.18)' },
  seco: { label: 'No Viable - Suelo Seco', color: '#ff9100', description: 'Riesgo alto de volatilización', colorAlpha: 'rgba(255, 145, 0, 0.18)' },
  saturado: { label: 'No Viable - Exceso Humedad', color: '#2979ff', description: 'Riesgo alto de lavado/escurrimiento', colorAlpha: 'rgba(41, 121, 255, 0.18)' }
};

const getFertilizacionInfo = (pct) => {
  if (pct >= 40 && pct <= 80) {
    return FERTILIZACION_NIVELES.viable;
  } else if (pct < 40) {
    return FERTILIZACION_NIVELES.seco;
  } else {
    return FERTILIZACION_NIVELES.saturado;
  }
};

const backgroundZonesPlugin = {
  id: 'backgroundZones',
  beforeDraw(chart) {
    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
    const maxVal = y.max;
    if (!maxVal || maxVal <= 0) return;
    
    ctx.save();
    
    const val0 = y.getPixelForValue(0);
    const val10 = y.getPixelForValue(maxVal * 0.10);
    const val30 = y.getPixelForValue(maxVal * 0.30);
    const val60 = y.getPixelForValue(maxVal * 0.60);
    const val100 = y.getPixelForValue(maxVal);

    // 1. Zona Estrés Severo (< 10%) - Morado muy suave
    ctx.fillStyle = 'rgba(200, 0, 255, 0.05)';
    ctx.fillRect(left, val10, right - left, val0 - val10);

    // 2. Zona Estrés (10% - 30%) - Rojo muy suave
    ctx.fillStyle = 'rgba(255, 75, 75, 0.05)';
    ctx.fillRect(left, val30, right - left, val10 - val30);

    // 3. Zona Atención (30% - 60%) - Amarillo muy suave
    ctx.fillStyle = 'rgba(255, 214, 0, 0.04)';
    ctx.fillRect(left, val60, right - left, val30 - val60);

    // 4. Zona Óptimo (> 60%) - Verde muy suave
    ctx.fillStyle = 'rgba(0, 200, 83, 0.04)';
    ctx.fillRect(left, val100, right - left, val60 - val100);

    ctx.restore();
  }
};

const SPI_CATEGORIAS = [
  { label: 'Extremadamente Húmedo', min: 2.0,  max: 99,  color: '#00b4d8', icon: '💧💧' },
  { label: 'Muy Húmedo',           min: 1.5,  max: 2.0,  color: '#48cae4', icon: '💧'  },
  { label: 'Algo Húmedo',          min: 1.0,  max: 1.5,  color: '#90e0ef', icon: '🌧'  },
  { label: 'Normal',               min: -1.0, max: 1.0,  color: '#52b788', icon: '✅'  },
  { label: 'Algo Seco',            min: -1.5, max: -1.0, color: '#ffd166', icon: '☀️'  },
  { label: 'Severamente Seco',     min: -2.0, max: -1.5, color: '#f4845f', icon: '🌵'  },
  { label: 'Extremadamente Seco',  min: -99,  max: -2.0, color: '#e63946', icon: '🔥'  },
];

const getSPICategoria = (spi) => {
  return SPI_CATEGORIAS.find(c => spi >= c.min && spi < c.max) || SPI_CATEGORIAS[3];
};

const PASTEL_COLORS = [
  '#ff9ff3', // 1. Rosado Pastel
  '#ffd166', // 2. Amarillo Cálido
  '#06d6a0', // 3. Verde Esmeralda Suave
  '#70a1ff', // 4. Azul Brillante Suave
  '#f78c6c', // 5. Naranja Coral
  '#a29bfe', // 6. Púrpura Lavanda
  '#81ecec', // 7. Turquesa/Cian
  '#ff6b6b', // 8. Salmón/Rojo Suave
  '#ddffab', // 9. Verde Lima Suave
  '#eccc68', // 10. Dorado Claro
];

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const normalizePluviometroName = (name) => {
  if (!name) return '';
  const n = String(name).trim().toLowerCase();
  if (n === 'san juan' || n === 'cecilia' || n === 'la cecilia') {
    return 'La Cecilia';
  }
  if (n === 'planta extractora' || n === 'p.extractora' || n === 'p. extractora') {
    return 'P.Extractora';
  }
  if (n === 'cebadero' || n === 'cebadero casa' || n === 'cebaderocasa') {
    return 'Cebadero';
  }
  return String(name)
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

const SOIL_TYPE_CAPACITIES = {
  'arcilloso': 120,
  'franco-arcilloso': 100,
  'franco': 80,
  'franco-arenoso': 60,
  'arenoso': 40
};

const getSoilCapacity = (soilName, fallbackGlobal) => {
  if (!soilName) return fallbackGlobal;
  const n = String(soilName).trim().toLowerCase();
  
  // Buscar coincidencia directa
  if (SOIL_TYPE_CAPACITIES[n] !== undefined) {
    return SOIL_TYPE_CAPACITIES[n];
  }
  
  // Búsqueda parcial / difusa
  if (n.includes('franco-arcilloso') || n.includes('franco arcilloso')) return SOIL_TYPE_CAPACITIES['franco-arcilloso'];
  if (n.includes('franco-arenoso') || n.includes('franco arenoso')) return SOIL_TYPE_CAPACITIES['franco-arenoso'];
  if (n.includes('arcilloso') || n.includes('arcilla')) return SOIL_TYPE_CAPACITIES['arcilloso'];
  if (n.includes('arenoso') || n.includes('arena')) return SOIL_TYPE_CAPACITIES['arenoso'];
  if (n.includes('franco')) return SOIL_TYPE_CAPACITIES['franco'];
  
  return fallbackGlobal;
};

const getLoteUniqueKey = (properties, index) => {
  if (!properties) return `lote-${index}`;
  const loteName = properties.NOMBRELOTE || properties.nombrelote || properties['NOMBRE LOT'] || properties.lote || properties.LOTE || properties.name || properties.id || `lote-${index}`;
  const subsector = properties.SUBSECTOR || '';
  return `${loteName}_${subsector}`.trim().toLowerCase();
};

const MONTH_NAMES_LONG = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function FitMapBounds({ geojson, triggerReset }) {
  const map = useMap();
  useEffect(() => {
    if (geojson && map) {
      // Retraso para esperar que el DOM se organice e invalidar tamaño de mapa
      const timer = setTimeout(() => {
        try {
          map.invalidateSize();
          const layer = L.geoJSON(geojson);
          const bounds = layer.getBounds();
          if (bounds.isValid()) {
            // Ajustamos con padding mínimo para acercar el zoom lo máximo posible
            map.fitBounds(bounds, { padding: [5, 5] });
          }
        } catch (e) {
          console.error("Error al enfocar el mapa en los límites del GeoJSON:", e);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [geojson, map, triggerReset]);
  return null;
}

function MapInteractionController({ active }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    try {
      if (active) {
        if (map.dragging) map.dragging.enable();
        if (map.doubleClickZoom) map.doubleClickZoom.enable();
        if (map.scrollWheelZoom) map.scrollWheelZoom.enable();
        if (map.boxZoom) map.boxZoom.enable();
        if (map.keyboard) map.keyboard.enable();
        if (map.touchZoom) map.touchZoom.enable();
      } else {
        if (map.dragging) map.dragging.disable();
        if (map.doubleClickZoom) map.doubleClickZoom.disable();
        if (map.scrollWheelZoom) map.scrollWheelZoom.disable();
        if (map.boxZoom) map.boxZoom.disable();
        if (map.keyboard) map.keyboard.disable();
        if (map.touchZoom) map.touchZoom.disable();
      }
    } catch (e) {
      console.warn("Fallo al cambiar interacciones del mapa:", e);
    }
  }, [active, map]);
  return null;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function getCoordinatesDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Metros
}

function detectTrackStops(track) {
  if (!track || !track.recorrido || track.recorrido.length < 2) return [];
  const stops = [];
  const points = track.recorrido;
  let currentGroup = [];
  
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (currentGroup.length === 0) {
      currentGroup.push(pt);
    } else {
      const anchor = currentGroup[0];
      const dist = getCoordinatesDistance(anchor.lat, anchor.lon, pt.lat, pt.lon);
      if (dist < 12) { // Menos de 12 metros de desplazamiento
        currentGroup.push(pt);
      } else {
        const durationMs = pt.timestamp - anchor.timestamp;
        if (durationMs >= 120000) { // Parado más de 2 minutos
          stops.push({
            lat: anchor.lat,
            lon: anchor.lon,
            startTime: anchor.timestamp,
            endTime: pt.timestamp,
            durationMinutes: Math.round(durationMs / 60000)
          });
        }
        currentGroup = [pt];
      }
    }
  }
  if (currentGroup.length > 1) {
    const anchor = currentGroup[0];
    const lastPt = currentGroup[currentGroup.length - 1];
    const durationMs = lastPt.timestamp - anchor.timestamp;
    if (durationMs >= 120000) {
      stops.push({
        lat: anchor.lat,
        lon: anchor.lon,
        startTime: anchor.timestamp,
        endTime: lastPt.timestamp,
        durationMinutes: Math.round(durationMs / 60000)
      });
    }
  }
  return stops;
}

function getActiveTrack(selectedTrackId, mobileTracks, mobileReadings) {
  if (!selectedTrackId) return null;
  const track = mobileTracks.find(t => t.id === selectedTrackId);
  if (track) return track;
  
  const match = selectedTrackId.match(/^readings-(.+)-(\d+)$/);
  if (!match) return null;
  const user = match[1];
  const ts = parseInt(match[2], 10);
  const dateStr = new Date(ts).toDateString();
  
  const readings = mobileReadings.filter(r => r.usuario === user && new Date(r.timestamp).toDateString() === dateStr);
  if (readings.length === 0) return null;
  
  const recorrido = readings
    .filter(r => r.gps)
    .map(r => ({
      lat: r.gps.lat,
      lon: r.gps.lon,
      timestamp: r.timestamp,
      accuracy: 10
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
    
  return {
    id: selectedTrackId,
    usuario: user,
    timestamp: ts,
    recorrido
  };
}

function FitTrackBounds({ track }) {
  const map = useMap();
  useEffect(() => {
    if (track && track.recorrido && track.recorrido.length > 0 && map) {
      const timer = setTimeout(() => {
        try {
          map.invalidateSize();
          const positions = track.recorrido.map(p => [p.lat, p.lon]);
          const bounds = L.latLngBounds(positions);
          if (bounds.isValid()) {
            const eastWestSpan = Math.abs(bounds.getEast() - bounds.getWest());
            const northSouthSpan = Math.abs(bounds.getNorth() - bounds.getSouth());
            if (eastWestSpan < 0.0008 && northSouthSpan < 0.0008) {
              // Si el recorrido tiene muy poca extensión (ej: un solo punto o estacionario),
              // centramos el mapa en el recorrido y fijamos un zoom moderado (15) para no ir al infinito
              map.setView(bounds.getCenter(), 15);
            } else {
              // Zoom adaptativo ajustado al recorrido completo
              map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15.5 });
            }
          }
        } catch (e) {
          console.error("Error al enfocar el mapa en el recorrido GPS:", e);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [track, map]);
  return null;
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const logoTimelineRef = useRef(null);
  const startupTimerRef = useRef(null);

  const handleLogoClick = () => {
    if (startupTimerRef.current) {
      clearTimeout(startupTimerRef.current);
      startupTimerRef.current = null;
    }
    if (logoTimelineRef.current) {
      logoTimelineRef.current.pause();
      // Resetear explícitamente los estados iniciales de todos los elementos para evitar fantasmas o desfases
      anime.set('.logo-droplet', { translateY: -60, opacity: 0, scaleX: 0.75, scaleY: 1.4 });
      anime.set('.logo-splash-p', { opacity: 0, scale: 0, translateX: 0, translateY: 0 });
      anime.set('.logo-palm', { opacity: 0, scale: 0 });
      // Ir al inicio de la línea de tiempo única y reproducir
      logoTimelineRef.current.seek(0);
      logoTimelineRef.current.play();
    }
  };

  useEffect(() => {
    // 1. Asegurar que las microgotas y la palma estén ocultas inicialmente al montar
    anime.set('.logo-splash-p', { opacity: 0 });
    anime.set('.logo-palm', { opacity: 0, scale: 0 });

    const timeline = anime.timeline({
      autoplay: false,
      complete: () => {
        // Bucle limpio manual: buscar el inicio y reproducir
        timeline.seek(0);
        timeline.play();
      }
    });

    timeline
      // 1. Caer (translateY de -60px a 0px) y estirarse en la caída
      .add({
        targets: '.logo-droplet',
        translateY: [-60, 0],
        scaleY: [1.4, 1],
        scaleX: [0.75, 1],
        opacity: {
          value: [0, 1],
          duration: 150,
          easing: 'linear'
        },
        duration: 600,
        easing: 'easeInQuad'
      })
      // 2. Impactar: aplastamiento rápido (squash) y desaparición
      .add({
        targets: '.logo-droplet',
        scaleY: [1, 0.15],
        scaleX: [1, 1.6],
        translateY: [0, 2],
        opacity: {
          value: [1, 0],
          duration: 80,
          delay: 40,
          easing: 'linear'
        },
        duration: 120,
        easing: 'easeOutQuad'
      })
      // 3. Explosión de partículas (salpicar) - se solapa con el impacto (inicia al inicio del paso 2)
      .add({
        targets: '.logo-splash-p',
        opacity: [
          { value: [0, 1], duration: 50 },
          { value: [1, 0], duration: 350, delay: 100 }
        ],
        translateX: (el, i) => {
          const angles = [-60, -30, 0, 30, 60];
          const angle = angles[i] * Math.PI / 180;
          return [0, Math.sin(angle) * 28];
        },
        translateY: (el, i) => {
          const angles = [-60, -30, 0, 30, 60];
          const angle = angles[i] * Math.PI / 180;
          return [0, -Math.cos(angle) * 20];
        },
        scale: [0.5, 2],
        duration: 500,
        easing: 'easeOutExpo'
      }, '-=120')
      // 4. Crecer Palma de Aceite desde el impacto (y = 22) - secuencial tras el splash
      .add({
        targets: '.logo-palm',
        opacity: [0, 1],
        scale: [0, 2.2],
        duration: 1200,
        easing: 'easeOutBack'
      })
      // 4b. Mantener la Palma visible antes de que comience a desvanecerse
      .add({
        targets: {},
        duration: 2000
      })
      // 5. Desvanecer Palma de Aceite
      .add({
        targets: '.logo-palm',
        opacity: [1, 0],
        scale: [2.2, 1.8],
        duration: 800,
        easing: 'easeInQuad'
      })
      // 6. Recomponerse: volver a formarse en su posición original con rebote elástico
      .add({
        targets: '.logo-droplet',
        opacity: [0, 1],
        scaleY: [0, 1],
        scaleX: [0, 1],
        translateY: [2, 0],
        duration: 800,
        easing: 'easeOutElastic(1, 0.5)'
      })
      // 7. Pausa de espera antes de subir (1 minuto = 60000ms)
      .add({
        targets: {},
        duration: 60000
      })
      // 8. Subir y desaparecer (preparación para la caída)
      .add({
        targets: '.logo-droplet',
        translateY: [0, -60],
        opacity: [1, 0],
        scaleY: [1, 1.4],
        scaleX: [1, 0.75],
        duration: 600,
        easing: 'easeOutQuad'
      });

    logoTimelineRef.current = timeline;

    // Reproducir automáticamente después de 3.5 segundos de montado el componente
    startupTimerRef.current = setTimeout(() => {
      timeline.play();
      startupTimerRef.current = null;
    }, 3500);

    return () => {
      if (startupTimerRef.current) {
        clearTimeout(startupTimerRef.current);
      }
      if (logoTimelineRef.current) {
        logoTimelineRef.current.pause();
      }
    };
  }, []);

  const [records, _setRecords] = useState([]);
  const setRecords = (rawRecords) => {
    if (!rawRecords) {
      _setRecords([]);
      return;
    }
    const normalized = rawRecords.map(r => {
      if (r) {
        let updated = r;
        if (r.dia !== undefined && r.mes !== undefined && r.anio !== undefined) {
          const expectedData = `${r.dia}/${r.mes}/${r.anio}`;
          if (r.data !== expectedData) {
            updated = { ...updated, data: expectedData };
          }
        }
        if (r.pluviometro) {
          const expectedPluv = normalizePluviometroName(r.pluviometro);
          if (r.pluviometro !== expectedPluv) {
            updated = { ...updated, pluviometro: expectedPluv };
          }
          const pluvLower = expectedPluv.toLowerCase();
          if (pluvLower === 'el rodeo' || pluvLower === 'rodeo') {
            if (updated.finca !== '03') {
              updated = { ...updated, finca: '03' };
            }
          }
        }
        return updated;
      }
      return r;
    });
    _setRecords(normalized);
  };
  const [loading, setLoading] = useState(false);
  const [loadingSource, setLoadingSource] = useState(''); // 'firebase', 'indexeddb'
  const [errorMessage, setErrorMessage] = useState(null);
  
  // Configuraciones de balance hídrico
  const [etReferencial, setEtReferencial] = useState(() => {
    return parseFloat(localStorage.getItem('etReferencial') || '3.5');
  });
  const [capacidadSuelo, setCapacidadSuelo] = useState(() => {
    return parseFloat(localStorage.getItem('capacidadSuelo') || '80');
  });
  const [umbralLluvia, setUmbralLluvia] = useState(() => {
    return parseFloat(localStorage.getItem('umbralLluvia') || '1.0');
  });
  const [kcCultivo, setKcCultivo] = useState(() => parseFloat(localStorage.getItem('kcCultivo') || '1.05'));
  const [kcEtapaIndex, setKcEtapaIndex] = useState(() => parseInt(localStorage.getItem('kcEtapaIndex') || '4'));

  const etcEfectiva = useMemo(() => etReferencial * kcCultivo, [etReferencial, kcCultivo]);

  // Estados de Sincronización Automática
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle', 'uploading', 'success', 'error'

  // Filtros
  const [selectedFinca, setSelectedFinca] = useState('');
  const [selectedPluviometro, setSelectedPluviometro] = useState('');
  const [selectedAnio, setSelectedAnio] = useState('');
  const [selectedMes, setSelectedMes] = useState('Todos');

  // Filtros independientes para la pestaña de Mapas
  const [selectedMapFinca, setSelectedMapFinca] = useState('');
  const [selectedMapPluviometro, setSelectedMapPluviometro] = useState('');
  const [selectedMapAnio, setSelectedMapAnio] = useState('');
  const [selectedMapMes, setSelectedMapMes] = useState('Todos');

  // Filtros independientes para la pestaña de Balance
  const [selectedBalanceFinca, setSelectedBalanceFinca] = useState('');
  const [selectedBalancePluviometro, setSelectedBalancePluviometro] = useState('Todos');
  const [selectedBalanceAnio, setSelectedBalanceAnio] = useState('');
  const [balanceChartType, setBalanceChartType] = useState('line');
  const [showSpiHelp, setShowSpiHelp] = useState(false);
  const balanceChartRef = useRef(null);
  const reservaChartRef = useRef(null);
  const spiChartRef = useRef(null);
  const [invertDeficitSign, setInvertDeficitSign] = useState(false);
  const [showHatching, setShowHatching] = useState(true);
  const [selectedCompareAnios, setSelectedCompareAnios] = useState([]);
  const [compareDropdownOpen, setCompareDropdownOpen] = useState(false);
  const compareDropdownRef = useRef(null);
  const monthlyChartRef = useRef(null);
  const comparativeChartRef = useRef(null);
  const geoJsonRef = useRef(null);
  const [compareChartType, setCompareChartType] = useState('bar');
  const [activeTab, setActiveTab] = useState('pluviometrico');
  const [fincaMaps, setFincaMaps] = useState({});
  const [selectedLotInfo, setSelectedLotInfo] = useState(null);
  const [showPluvZones, setShowPluvZones] = useState(false);
  const [humDisplayMode, setHumDisplayMode] = useState('off'); // 'off', 'moisture', 'fertility'
  const [mapUploadFinca, setMapUploadFinca] = useState('HLG');
  const [mapUploadStatus, setMapUploadStatus] = useState('idle'); // 'idle', 'uploading', 'success', 'error'
  const [mapUploadError, setMapUploadError] = useState(null);
  const [soils, setSoils] = useState([]);
  const [soilUploadStatus, setSoilUploadStatus] = useState('idle'); // 'idle', 'uploading', 'success', 'error'
  const [soilErrorMessage, setSoilErrorMessage] = useState(null);
  const [soilSyncProgress, setSoilSyncProgress] = useState(0);
  const [soilSyncTotal, setSoilSyncTotal] = useState(0);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(() => {
    return sessionStorage.getItem('isAdminLoggedIn') === 'true';
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [mobileTracks, setMobileTracks] = useState([]);
  const [mobileReadings, setMobileReadings] = useState([]);
  const [trackActive, setTrackActive] = useState(false);
  const [useSatelliteBackground, setUseSatelliteBackground] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [interpolationFactor, setInterpolationFactor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const activeFincaKey = selectedMapFinca === 'Todas' ? 'HLG' : (FINCA_MAPS_KEYS[selectedMapFinca] || selectedMapFinca);
  const activeMapGeoJSON = fincaMaps[activeFincaKey];

  const activePluvs = useMemo(() => {
    if (!activeMapGeoJSON || !activeMapGeoJSON.features) return [];
    return [...new Set(activeMapGeoJSON.features.map(f => {
      const pluvVal = f.properties?.PLUVIOMETR || f.properties?.pluviometro || f.properties?.pluv || f.properties?.pluviometro_lote || f.properties?.PLUVIOMETRO || f.properties?.Pluviometro;
      return normalizePluviometroName(pluvVal);
    }).filter(Boolean))].sort();
  }, [activeMapGeoJSON]);

  const getPastelColorForPluviometro = useCallback((pluv) => {
    if (!pluv) return 'rgba(255, 255, 255, 0.2)';
    const key = normalizePluviometroName(pluv);
    const idx = activePluvs.indexOf(key);
    if (idx === -1) return 'rgba(255, 255, 255, 0.2)';
    return PASTEL_COLORS[idx % PASTEL_COLORS.length];
  }, [activePluvs]);

  const selectedLotCenter = useMemo(() => {
    if (!selectedLotInfo) return null;
    try {
      const layer = L.geoJSON(selectedLotInfo);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        return bounds.getCenter();
      }
    } catch (e) {
      console.error("Error calculating lot center:", e);
    }
    return null;
  }, [selectedLotInfo]);

  // Estados para Consulta de Datos Históricos (Modal)
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyFinca, setHistoryFinca] = useState('Todas');
  const [historyPluviometro, setHistoryPluviometro] = useState('Todos');
  const [historyAnio, setHistoryAnio] = useState('Todos');
  const [historyMes, setHistoryMes] = useState('Todos');
  const [historySearch, setHistorySearch] = useState('');
  const [historySortConfig, setHistorySortConfig] = useState({ key: 'data', direction: 'desc' });

  const handleOpenHistoryModal = () => {
    setHistoryFinca(selectedFinca || 'Todas');
    setHistoryPluviometro(selectedPluviometro || 'Todos');
    setHistoryAnio(selectedAnio || 'Todos');
    setHistoryMes(selectedMes || 'Todos');
    setHistorySearch('');
    setHistorySortConfig({ key: 'data', direction: 'desc' });
    setHistoryModalOpen(true);
  };

  const sanitizeFileName = (name) => {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ñ/g, "n")
      .replace(/Ñ/g, "N")
      .replace(/[^a-zA-Z0-9_.-]/g, "_");
  };

  const handleDownloadExcel = () => {
    if (processedHistoryRecords.length === 0) return;

    const dataToExport = processedHistoryRecords.map(r => ({
      SEMANA: r.semana,
      FINCA: r.finca,
      PLUVIOMETRO: r.pluviometro,
      AÑO: r.anio,
      MES_DESC: r.mesDesc,
      DIA: r.dia,
      PREC: r.prec,
      MES: r.mes,
      DATA: r.data
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Datos Históricos');

    const fileName = sanitizeFileName('pluviometria_datos_historicos.xlsx');
    XLSX.writeFile(workbook, fileName);
  };

  const handleDownloadMatrixExcel = () => {
    if (!matrixData || !matrixData.matrix) return;

    const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const rows = [];

    MONTHS.forEach((monthName, mIdx) => {
      const row = { 'Mes': monthName };

      for (let day = 1; day <= 31; day++) {
        const val = matrixData.matrix[mIdx][day - 1];
        row[String(day)] = val > 0 ? Number(val.toFixed(1)) : 0;
      }

      row['Total Mes'] = Math.round(matrixData.rowTotals[mIdx]);
      row['Num Eventos'] = matrixData.rowEvents[mIdx] > 0 ? matrixData.rowEvents[mIdx] : '-';

      rows.push(row);
    });

    const totalRow = { 'Mes': 'TOTAL' };
    for (let day = 1; day <= 31; day++) {
      totalRow[String(day)] = '';
    }
    totalRow['Total Mes'] = Math.round(matrixData.totalYearPrec);
    totalRow['Num Eventos'] = matrixData.totalYearEvents;
    rows.push(totalRow);

    // Forzar el orden de las columnas colocando 'Mes' al principio
    const headers = [
      'Mes',
      ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
      'Total Mes',
      'Num Eventos'
    ];

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

    // Definir los anchos de columna para que el archivo sea cómodo y no aparezca recortado
    worksheet['!cols'] = [
      { wch: 12 }, // Mes
      ...Array.from({ length: 31 }, () => ({ wch: 5 })), // Días 1 al 31
      { wch: 12 }, // Total Mes
      { wch: 15 }  // Num Eventos
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Matriz de Lluvias');

    const activeYear = matrixData.activeYear || new Date().getFullYear();
    const fileName = sanitizeFileName(`matriz_lluvias_${activeYear}.xlsx`);
    XLSX.writeFile(workbook, fileName);
  };

  const handleDownloadBalanceExcel = () => {
    if (!balanceTableData || balanceTableData.length === 0) return;

    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const fincaLabel = FINCA_NAMES[selectedBalanceFinca] || selectedBalanceFinca || 'Balance';
    const pluvLabel = selectedBalancePluviometro && selectedBalancePluviometro !== 'Todos'
      ? selectedBalancePluviometro
      : 'Promedio Ponderado';

    const rows = balanceTableData.map(row => {
      const obj = { 'Año': row.year };
      MONTHS.forEach((m, i) => {
        obj[m] = row.months[i] > 0 ? Number(row.months[i].toFixed(1)) : 0;
      });
      obj['Total'] = Number(row.total.toFixed(1));
      return obj;
    });

    const headers = ['Año', ...MONTHS, 'Total'];
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

    worksheet['!cols'] = [
      { wch: 8 },
      ...Array.from({ length: 12 }, () => ({ wch: 9 })),
      { wch: 10 }
    ];

    const workbook = XLSX.utils.book_new();
    const sheetName = `${fincaLabel} - ${pluvLabel}`.substring(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const rawFileName = `consolidado_${fincaLabel}_${pluvLabel}.xlsx`;
    const fileName = sanitizeFileName(rawFileName.replace(/\s+/g, '_').toLowerCase());
    XLSX.writeFile(workbook, fileName);
  };

  const handleDownloadSpiExcel = () => {
    if (!spiData || spiData.insuficiente || !spiData.tablaAnual || spiData.tablaAnual.length === 0) return;

    const fincaLabel = FINCA_NAMES[selectedBalanceFinca] || selectedBalanceFinca || 'Finca';
    const pluvLabel = selectedBalancePluviometro && selectedBalancePluviometro !== 'Todos'
      ? selectedBalancePluviometro
      : 'Todos';

    const rows = spiData.tablaAnual.map(row => {
      return {
        'Año': row.year,
        'Lluvia Total (mm)': Number(row.precAnual.toFixed(1)),
        'Promedio Histórico (mm)': Number(row.media.toFixed(1)),
        'Diferencia (mm)': Number(row.diferencia.toFixed(1)),
        'Porcentaje (%)': Number(row.pct.toFixed(1)),
        'SPI-12': Number(row.spi12.toFixed(2)),
        'Clasificación': `${row.categoria.icon} ${row.categoria.label}`
      };
    });

    const headers = [
      'Año', 
      'Lluvia Total (mm)', 
      'Promedio Histórico (mm)', 
      'Diferencia (mm)', 
      'Porcentaje (%)', 
      'SPI-12', 
      'Clasificación'
    ];
    
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

    worksheet['!cols'] = [
      { wch: 8 },
      { wch: 18 },
      { wch: 22 },
      { wch: 15 },
      { wch: 15 },
      { wch: 10 },
      { wch: 25 }
    ];

    const workbook = XLSX.utils.book_new();
    const sheetName = `SPI_${fincaLabel}`.substring(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const rawFileName = `spi_historico_${fincaLabel}_${pluvLabel}.xlsx`;
    const fileName = sanitizeFileName(rawFileName.replace(/\s+/g, '_').toLowerCase());
    XLSX.writeFile(workbook, fileName);
  };


  const handleDownloadBalanceMensual = (precipData, etMonthly, selectedYearInt, fincaLabel, pluvLabel) => {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    
    // Determinar el último año y mes con datos en la base para esta finca/pluviómetro
    let dbMaxYear = 0;
    let dbMaxMonth = 0;
    let filteredFinca = records.filter(r => r.finca === selectedBalanceFinca);
    if (pluvLabel && pluvLabel !== 'Todos') {
      filteredFinca = filteredFinca.filter(r => r.pluviometro === pluvLabel);
    }
    filteredFinca.forEach(r => {
      if (r.anio > dbMaxYear) {
        dbMaxYear = r.anio;
        dbMaxMonth = r.mes;
      } else if (r.anio === dbMaxYear) {
        if (r.mes > dbMaxMonth) {
          dbMaxMonth = r.mes;
        }
      }
    });

    let maxActiveMonth = 0;
    if (selectedYearInt < dbMaxYear) {
      maxActiveMonth = 12;
    } else if (selectedYearInt === dbMaxYear) {
      maxActiveMonth = dbMaxMonth;
    }

    const balanceData = precipData.map((prec, idx) => {
      const monthNum = idx + 1;
      if (monthNum > maxActiveMonth) return '-';
      const et = etMonthly[idx];
      const val = prec - et;
      if (invertDeficitSign && val < 0) {
        return Math.abs(val);
      }
      return val;
    });

    const rows = [
      {
        Concepto: 'Precipitación Efectiva (mm)',
        ...months.reduce((acc, m, idx) => ({ ...acc, [m]: (idx + 1) <= maxActiveMonth && precipData[idx] !== null ? Number(precipData[idx].toFixed(1)) : '-' }), {})
      },
      {
        Concepto: 'Evapotranspiración (mm)',
        ...months.reduce((acc, m, idx) => ({ ...acc, [m]: (idx + 1) <= maxActiveMonth ? Number(etMonthly[idx].toFixed(1)) : '-' }), {})
      },
      {
        Concepto: invertDeficitSign ? 'Déficit / Exceso (mm) [Positivos]' : 'Déficit / Exceso (mm)',
        ...months.reduce((acc, m, idx) => ({ ...acc, [m]: (idx + 1) <= maxActiveMonth ? Number(Number(balanceData[idx]).toFixed(1)) : '-' }), {})
      }
    ];

    const headers = ['Concepto', ...months];
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

    worksheet['!cols'] = [
      { wch: 30 },
      ...Array.from({ length: 12 }, () => ({ wch: 10 }))
    ];

    const workbook = XLSX.utils.book_new();
    const sheetName = `Balance ${selectedYearInt}`.substring(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const rawFileName = `balance_mensual_${selectedYearInt}_${fincaLabel}_${pluvLabel}.xlsx`;
    const fileName = sanitizeFileName(rawFileName.replace(/\s+/g, '_').toLowerCase());
    XLSX.writeFile(workbook, fileName);
  };

  const downloadBase64File = (base64Url, fileName) => {
    try {
      const parts = base64Url.split(';base64,');
      if (parts.length !== 2) {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = base64Url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      const contentType = parts[0].split(':')[1];
      const raw = window.atob(parts[1]);
      const rawLength = raw.length;
      const uInt8Array = new Uint8Array(rawLength);

      for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
      }

      const blob = new Blob([uInt8Array], { type: contentType });
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.download = fileName;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
    } catch (e) {
      console.error("Error al descargar archivo base64:", e);
      const link = document.createElement('a');
      link.download = fileName;
      link.href = base64Url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleDownloadChart = (chartRef, defaultTitle) => {
    const chartWrapper = chartRef.current;
    if (!chartWrapper) return;

    // Obtener la instancia de Chart.js
    const chartInstance = chartWrapper.chart || chartWrapper;
    let url = '';

    if (chartInstance && typeof chartInstance.toBase64Image === 'function') {
      url = chartInstance.toBase64Image();
    } else {
      // Búsqueda de fallback al elemento canvas directamente
      const canvas = chartWrapper.canvas || (chartWrapper.ctx && chartWrapper.ctx.canvas);
      if (canvas && typeof canvas.toDataURL === 'function') {
        url = canvas.toDataURL('image/png');
      }
    }

    if (url) {
      const cleanName = `${sanitizeFileName(defaultTitle)}.png`;
      downloadBase64File(url, cleanName);
    }
  };

  const handleDownloadFullPanel = (elementId, defaultTitle) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Ocultar temporalmente los botones de descarga de este panel
    const downloadButtons = element.querySelectorAll('button');
    const hiddenButtons = [];
    downloadButtons.forEach(btn => {
      if (btn.textContent && (btn.textContent.includes('Descargar') || btn.textContent.includes('Gráfico'))) {
        btn.style.setProperty('display', 'none', 'important');
        hiddenButtons.push(btn);
      }
    });

    html2canvas(element, {
      backgroundColor: '#0d1117',
      scale: 2,
      useCORS: true,
      logging: false
    }).then(canvas => {
      // Restaurar visualización
      hiddenButtons.forEach(btn => {
        btn.style.display = '';
      });

      const url = canvas.toDataURL('image/png');
      const cleanName = `${sanitizeFileName(defaultTitle)}.png`;
      downloadBase64File(url, cleanName);
    }).catch(err => {
      console.error("Error al exportar el panel completo:", err);
      hiddenButtons.forEach(btn => {
        btn.style.display = '';
      });
    });
  };



  // Pluviómetros disponibles locales del modal
  const historyAvailablePluviometros = useMemo(() => {
    if (records.length === 0) return [];
    if (historyFinca === 'Todas') {
      return [...new Set(records.map(r => r.pluviometro))].sort();
    }
    return [...new Set(records.filter(r => r.finca === historyFinca).map(r => r.pluviometro))].sort();
  }, [records, historyFinca]);

  // Años disponibles locales del modal
  const historyAvailableAnios = useMemo(() => {
    let filtered = records;
    if (historyFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === historyFinca);
    }
    if (historyPluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === historyPluviometro);
    }
    return [...new Set(filtered.map(r => r.anio))].sort((a, b) => b - a);
  }, [records, historyFinca, historyPluviometro]);

  // Lógica de procesamiento de datos para la tabla histórica modal (filtrado y ordenamiento)
  const processedHistoryRecords = useMemo(() => {
    let filtered = [...records];

    if (historyFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === historyFinca);
    }
    if (historyPluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === historyPluviometro);
    }
    if (historyAnio !== 'Todos') {
      filtered = filtered.filter(r => r.anio === parseInt(historyAnio, 10));
    }
    if (historyMes !== 'Todos') {
      filtered = filtered.filter(r => r.mesDesc === historyMes);
    }
    if (historySearch.trim() !== '') {
      const q = historySearch.toLowerCase();
      filtered = filtered.filter(r => 
        r.pluviometro.toLowerCase().includes(q) || 
        r.mesDesc.toLowerCase().includes(q) ||
        r.data.includes(q)
      );
    }

    if (historySortConfig.key) {
      const { key, direction } = historySortConfig;
      filtered.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        if (key === 'data') {
          const partsA = String(a.data).split('/');
          const partsB = String(b.data).split('/');
          if (partsA.length === 3 && partsB.length === 3) {
            valA = new Date(partsA[2], partsA[1] - 1, partsA[0]).getTime();
            valB = new Date(partsB[2], partsB[1] - 1, partsB[0]).getTime();
          }
        }

        if (typeof valA === 'number' && typeof valB === 'number') {
          return direction === 'asc' ? valA - valB : valB - valA;
        }

        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return direction === 'asc' ? -1 : 1;
        if (strA > strB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [records, historyFinca, historyPluviometro, historyAnio, historyMes, historySearch, historySortConfig]);

  const requestHistorySort = (key) => {
    let direction = 'asc';
    if (historySortConfig.key === key && historySortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setHistorySortConfig({ key, direction });
  };

  // Calcular la precipitación acumulada por cada pluviómetro según filtros activos en la pestaña de mapas
  const mapPluviometroPrecipitations = useMemo(() => {
    const data = {};
    if (records.length === 0) return data;

    let filtered = records;
    if (selectedMapAnio !== 'Todos') {
      filtered = filtered.filter(r => String(r.anio) === selectedMapAnio);
    }
    if (selectedMapMes !== 'Todos') {
      filtered = filtered.filter(r => String(r.mes) === selectedMapMes);
    }

    filtered.forEach(r => {
      const pluv = String(r.pluviometro || '').trim().toLowerCase();
      if (!pluv) return;
      if (!data[pluv]) {
        data[pluv] = {
          totalPrec: 0,
          events: 0
        };
      }
      data[pluv].totalPrec += r.prec || 0;
      if (r.prec > 0) {
        data[pluv].events += 1;
      }
    });

    return data;
  }, [records, selectedMapAnio, selectedMapMes]);

  // Calcular la Capacidad de Agua Disponible (CAD) por cada lote individual según su tipo de suelo y el pluviómetro correspondiente
  const mapLotesCad = useMemo(() => {
    const data = {};
    if (records.length === 0 || !selectedMapAnio || !activeMapGeoJSON || !activeMapGeoJSON.features) return data;

    // 1. Agrupar registros por pluviómetro para evitar repetir el filtrado en cada iteración de lote
    const pluvGroups = {};
    records.forEach(r => {
      const pluvKey = normalizePluviometroName(r.pluviometro).toLowerCase();
      if (!pluvKey) return;
      if (!pluvGroups[pluvKey]) {
        pluvGroups[pluvKey] = [];
      }
      pluvGroups[pluvKey].push(r);
    });

    // 2. Correr balance hídrico para cada lote (feature)
    activeMapGeoJSON.features.forEach((feature, index) => {
      const props = feature.properties || {};
      const loteKey = getLoteUniqueKey(props, index);

      // Encontrar pluviómetro asociado al lote
      const pluvVal = props.PLUVIOMETR || props.pluviometro || props.pluv || props.pluviometro_lote || props.PLUVIOMETRO || props.Pluviometro;
      if (!pluvVal) return;
      const pluvKey = normalizePluviometroName(pluvVal).toLowerCase();
      const pluvRecords = pluvGroups[pluvKey];

      if (!pluvRecords || pluvRecords.length === 0) return;

      // ⚠️ PENDIENTE: El tipo de suelo por lote no está disponible en el GeoJSON.
      // Hasta que el usuario entregue el archivo con los tipos de suelo por lote/pluviómetro,
      // se usa un valor PROVISIONAL: suelo Franco (80 mm). Esto afecta el cálculo de HDR.
      // Para actualizar: completar la tabla SOIL_TYPE_CAPACITIES y el mapeo de lotes.
      const tipoSuelo = props.suelo || props.SUELO || props.tipo_suelo || props.TIPO_SUELO ||
        props.textura || props.TEXTURA || props.textura_su || props.TEXTURA_SU ||
        props.TIPO_SUEL || props.tipo_suel || props.CLASE_TEXT || props.clase_text ||
        props.CLASE_SUEL || props.clase_suel || props.SOIL_TYPE || props.soil_type ||
        props.TSUELO || props.tsuelo || props.T_SUELO || props.t_suelo ||
        props.SUELO_TIP || props.suelo_tip || 'franco'; // 🔴 PROVISIONAL — reemplazar con datos reales
      const capacidadEspecifica = getSoilCapacity(tipoSuelo, capacidadSuelo);

      // Resolver año
      let targetYear = selectedMapAnio;
      if (targetYear === 'Todos') {
        const availableYears = [...new Set(pluvRecords.map(r => r.anio))].sort((a, b) => b - a);
        targetYear = availableYears.length > 0 ? String(availableYears[0]) : '';
      }

      if (!targetYear) return;

      // Correr balance con la capacidad específica de este lote
      const balanceArray = calculateWaterBalance(
        pluvRecords,
        etcEfectiva,
        capacidadEspecifica,
        targetYear,
        selectedMapMes
      );

      if (balanceArray && balanceArray.length > 0) {
        const lastDay = balanceArray[balanceArray.length - 1];
        const reserveVal = lastDay.balanceAcumulado;
        const pct = capacidadEspecifica > 0 ? (reserveVal / capacidadEspecifica) * 100 : 0;
        const level = getNivelEstres(reserveVal, capacidadEspecifica);

        data[loteKey] = {
          reserve: reserveVal,
          pct: pct,
          level: level,
          lastDay: lastDay,
          capacidad: capacidadEspecifica,
          suelo: (tipoSuelo && tipoSuelo !== 'franco') ? tipoSuelo : 'Franco (provisional) ⚠️',
          fertilizacion: getFertilizacionInfo(pct)
        };
      }
    });

    return data;
  }, [records, activeMapGeoJSON, selectedMapAnio, selectedMapMes, etcEfectiva, capacidadSuelo]);

  const getPrecipitationForFeature = (feature) => {
    if (!feature || !feature.properties) return 0;
    const props = feature.properties;
    
    // Buscar la clave del pluviómetro de forma flexible (incluyendo el límite de caracteres de Shapefile 'PLUVIOMETR')
    const pluvKey = props.PLUVIOMETR || props.pluviometro || props.pluv || props.pluviometro_lote || props.PLUVIOMETRO || props.Pluviometro;
    if (!pluvKey) return 0;
    
    const key = normalizePluviometroName(pluvKey).toLowerCase();
    const data = mapPluviometroPrecipitations[key];
    return data ? data.totalPrec : 0;
  };

  const getAreaFromProperties = (props) => {
    if (!props) return 0;
    const val = props.HA || props['HAS. NETAS'] || props['HAS NETAS'] || props.HAS_NETAS || props.HECTAREAS || props.hectareas || props.area || props.AREA || props.Area;
    if (val === undefined || val === null) return 0;
    // Manejar separadores decimales si son texto con comas y limpiar caracteres no numéricos como espacios
    const normalized = String(val).replace(/,/g, '.').replace(/[^\d.-]/g, '');
    const num = parseFloat(normalized);
    return isNaN(num) ? 0 : num;
  };

  const checkIfFeatureIsSelected = (feature, currentSel) => {
    if (!feature || !currentSel || !currentSel.properties) return false;
    const fProps = feature.properties;
    const sProps = currentSel.properties;
    
    return (
      (fProps.ID && sProps.ID && fProps.ID === sProps.ID) ||
      (fProps.NOMBRELOTE && sProps.NOMBRELOTE && fProps.NOMBRELOTE === sProps.NOMBRELOTE) ||
      (fProps['NOMBRE LOT'] && sProps['NOMBRE LOT'] && fProps['NOMBRE LOT'] === sProps['NOMBRE LOT']) ||
      (fProps.LOTE && sProps.LOTE && fProps.LOTE === sProps.LOTE && fProps.SUBSECTOR && sProps.SUBSECTOR && fProps.SUBSECTOR === sProps.SUBSECTOR && fProps.FINCA === sProps.FINCA)
    );
  };

  const showPluvZonesRef = useRef(showPluvZones);
  const humDisplayModeRef = useRef(humDisplayMode);
  const mapLotesCadRef = useRef(mapLotesCad);
  const selectedLotInfoRef = useRef(selectedLotInfo);

  useEffect(() => {
    showPluvZonesRef.current = showPluvZones;
  }, [showPluvZones]);

  useEffect(() => {
    humDisplayModeRef.current = humDisplayMode;
  }, [humDisplayMode]);

  useEffect(() => {
    mapLotesCadRef.current = mapLotesCad;
  }, [mapLotesCad]);

  useEffect(() => {
    selectedLotInfoRef.current = selectedLotInfo;
  }, [selectedLotInfo]);

  // Efecto para actualizar dinámicamente los estilos y tooltips de Leaflet sin recrear capas (evita capas fantasma)
  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.eachLayer((layer) => {
        const feature = layer.feature;
        if (!feature) return;
        
        const isSel = checkIfFeatureIsSelected(feature, selectedLotInfo);
        const pluvVal = feature.properties.PLUVIOMETR || feature.properties.pluviometro || feature.properties.pluv || feature.properties.pluviometro_lote || feature.properties.PLUVIOMETRO || feature.properties.Pluviometro;
        const normalizedPluv = normalizePluviometroName(pluvVal);
        
        // Determinar si este lote corresponde al pluviómetro seleccionado en el filtro
        const isFilteredPluv = selectedMapPluviometro && selectedMapPluviometro !== 'Todos';
        const isMatchingPluv = !isFilteredPluv || normalizePluviometroName(selectedMapPluviometro) === normalizedPluv;

        let fillColor = 'rgba(0, 242, 254, 0.05)';
        let borderColor = isSel ? '#00f2fe' : 'rgba(255, 255, 255, 0.2)';
        let fillOpacity = isSel ? 0.2 : 0.08;
        let weight = isSel ? 2.5 : 0.8;

        if (showPluvZones) {
          if (isMatchingPluv) {
            // Colorear normalmente con el color del pluviómetro
            const pluvColor = getPastelColorForPluviometro(pluvVal);
            fillColor = pluvColor;
            fillOpacity = isSel ? 0.35 : 0.16;
            if (!isSel) {
              borderColor = hexToRgba(pluvColor, 0.55);
            }
          } else {
            // Zona de otro pluviómetro: apagar a gris neutral
            fillColor = 'rgba(120, 120, 120, 0.08)';
            fillOpacity = 0.08;
            borderColor = 'rgba(255, 255, 255, 0.08)';
          }
        } else if (humDisplayMode === 'moisture') {
          const loteKey = getLoteUniqueKey(feature.properties, '');
          const cadData = mapLotesCad[loteKey];
          if (cadData) {
            fillColor = cadData.level.color;
            fillOpacity = isSel ? 0.55 : 0.3;
            if (!isSel) {
              borderColor = hexToRgba(cadData.level.color, 0.65);
            }
          } else {
            // Sin datos
            fillColor = 'rgba(120, 120, 120, 0.08)';
            fillOpacity = 0.08;
            borderColor = 'rgba(255, 255, 255, 0.08)';
          }
        } else if (humDisplayMode === 'fertility') {
          const loteKey = getLoteUniqueKey(feature.properties, '');
          const cadData = mapLotesCad[loteKey];
          if (cadData) {
            fillColor = cadData.fertilizacion.color;
            fillOpacity = isSel ? 0.55 : 0.3;
            if (!isSel) {
              borderColor = hexToRgba(cadData.fertilizacion.color, 0.65);
            }
          } else {
            // Sin datos
            fillColor = 'rgba(120, 120, 120, 0.08)';
            fillOpacity = 0.08;
            borderColor = 'rgba(255, 255, 255, 0.08)';
          }
        }

        layer.setStyle({
          fillColor,
          weight,
          opacity: 1,
          color: borderColor,
          fillOpacity,
        });

        // Manejar Tooltips dinámicos
        const loteName = feature.properties.NOMBRELOTE || feature.properties.nombrelote || feature.properties['NOMBRE LOT'] || feature.properties.lote || feature.properties.LOTE || feature.properties.name || feature.properties.id || '';
        
        layer.unbindTooltip();
        
        if (loteName && !isSel) {
          let tooltipContent = loteName;
          if (humDisplayMode === 'moisture') {
            const loteKey = getLoteUniqueKey(feature.properties, '');
            const cadData = mapLotesCad[loteKey];
            if (cadData) {
              tooltipContent = `${loteName} (Humedad: ${cadData.pct.toFixed(0)}%)`;
            }
          } else if (humDisplayMode === 'fertility') {
            const loteKey = getLoteUniqueKey(feature.properties, '');
            const cadData = mapLotesCad[loteKey];
            if (cadData) {
              tooltipContent = `${loteName} (${cadData.fertilizacion.label})`;
            }
          }
          
          layer.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'center',
            sticky: true,
            className: 'custom-map-tooltip'
          });
        }
      });
    }
  }, [showPluvZones, humDisplayMode, mapLotesCad, selectedLotInfo, activeMapGeoJSON, getPastelColorForPluviometro, selectedMapPluviometro, activeTab]);

  // Controlar selección de finca en la pestaña de mapas y reiniciar lote seleccionado
  useEffect(() => {
    setSelectedLotInfo(null);

    const available = Object.keys(fincaMaps);
    if (available.length > 0) {
      const activeKey = selectedMapFinca === 'Todas' ? 'HLG' : (FINCA_MAPS_KEYS[selectedMapFinca] || selectedMapFinca);
      
      // Si la finca actual de los mapas es vacía o no tiene un GeoJSON cargado, forzar la primera disponible que sí tenga
      if (!selectedMapFinca || selectedMapFinca === 'Todas' || !available.includes(activeKey)) {
        const firstAvailableKey = available[0];
        const fincaCode = REVERSE_FINCA_MAPS_KEYS[firstAvailableKey] || firstAvailableKey;
        setSelectedMapFinca(fincaCode);
      }
    }
  }, [selectedMapFinca, fincaMaps]);
  
  // Carga inicial optimizada (Stale-While-Revalidate):
  // 1. Carga los datos instantáneamente de IndexedDB local
  // 2. Descarga datos frescos de Firebase en segundo plano sin bloquear la UI
  const loadInitialData = async () => {
    setErrorMessage(null);
    let hasLocalData = false;

    // Paso 1: Carga local inmediata
    try {
      const localRecords = await loadHistoricalRecords();
      if (localRecords && localRecords.length > 0) {
        setRecords(localRecords);
        initializeFilters(localRecords);
        hasLocalData = true;
      }
    } catch (dbErr) {
      console.error("Error al leer IndexedDB local inicial:", dbErr);
    }

    try {
      const localSoils = await loadSoilRecords();
      if (localSoils && localSoils.length > 0) {
        setSoils(localSoils);
      }
    } catch (soilsDbErr) {
      console.error("Error al leer IndexedDB de suelos inicial:", soilsDbErr);
    }

    try {
      const HLG_map = await getLocalMap('HLG');
      const HSL_map = await getLocalMap('HSL');
      const TUC_map = await getLocalMap('TUC');
      const mapsObj = {};
      if (HLG_map) mapsObj['HLG'] = HLG_map;
      if (HSL_map) mapsObj['HSL'] = HSL_map;
      if (TUC_map) mapsObj['TUC'] = TUC_map;
      setFincaMaps(mapsObj);
    } catch (mapErr) {
      console.error("Error al cargar mapas locales IndexedDB:", mapErr);
    }

    // Si no tenemos datos locales, mostramos el cargador principal
    if (!hasLocalData) {
      setLoading(true);
      setLoadingSource('Cargando base de datos por primera vez...');
    }

    // Paso 2: Revalidación en segundo plano desde Firebase
    try {
      const cloudRecords = await downloadRecords();
      if (cloudRecords && cloudRecords.length > 0) {
        await saveHistoricalRecords(cloudRecords);
        setRecords(cloudRecords);
        initializeFilters(cloudRecords);
      }
    } catch (firebaseErr) {
      console.warn("Fallo al revalidar base de datos con Firebase Cloud (offline):", firebaseErr);
      if (!hasLocalData) {
        setErrorMessage("No se pudo conectar a Firebase y no existen datos locales guardados.");
      }
    }

    try {
      const cloudMaps = await downloadMaps();
      if (cloudMaps && cloudMaps.length > 0) {
        const mapsObj = {};
        for (const item of cloudMaps) {
          const key = FINCA_MAPS_KEYS[item.fincaId] || item.fincaId;
          mapsObj[key] = item.geojson;
          await saveLocalMap(key, item.geojson);
        }
        setFincaMaps(prev => ({ ...prev, ...mapsObj }));
      }
    } catch (firebaseMapErr) {
      console.warn("Fallo al revalidar mapas con Firebase Cloud (offline):", firebaseMapErr);
    }

    try {
      const cloudSoils = await downloadSoilRecords();
      if (cloudSoils && cloudSoils.length > 0) {
        await saveSoilRecords(cloudSoils);
        setSoils(cloudSoils);
      }
    } catch (firebaseSoilsErr) {
      console.warn("Fallo al revalidar suelos con Firebase Cloud (offline):", firebaseSoilsErr);
    }

    try {
      const cloudTracks = await downloadMobileTracks();
      setMobileTracks(cloudTracks);
    } catch (firebaseTracksErr) {
      console.warn("Fallo al descargar recorridos móviles:", firebaseTracksErr);
    }

    try {
      const cloudReadings = await downloadMobileReadings();
      setMobileReadings(cloudReadings);
    } catch (firebaseReadingsErr) {
      console.warn("Fallo al descargar lecturas de campo:", firebaseReadingsErr);
    } finally {
      setLoading(false);
      setLoadingSource('');
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Cerrar el dropdown de comparación al hacer clic fuera del mismo
  useEffect(() => {
    function handleClickOutside(event) {
      if (compareDropdownRef.current && !compareDropdownRef.current.contains(event.target)) {
        setCompareDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Inicializa filtros de fincas/pluviómetros
  const initializeFilters = (data) => {
    const fincasDisponibles = [...new Set(data.map(r => r.finca))].sort();
    if (fincasDisponibles.length > 0) {
      setSelectedFinca('Todas');
    }
  };

  // Guardar configuraciones de ET y umbral de lluvia en localStorage al cambiar
  useEffect(() => {
    localStorage.setItem('etReferencial', etReferencial.toString());
    localStorage.setItem('capacidadSuelo', capacidadSuelo.toString());
    localStorage.setItem('umbralLluvia', umbralLluvia.toString());
    localStorage.setItem('kcCultivo', kcCultivo.toString());
    localStorage.setItem('kcEtapaIndex', kcEtapaIndex.toString());
  }, [etReferencial, capacidadSuelo, umbralLluvia, kcCultivo, kcEtapaIndex]);

  // Autodetección de la etapa de cultivo basada en el año de siembra de los lotes del GeoJSON activo
  useEffect(() => {
    if (!activeMapGeoJSON || !activeMapGeoJSON.features) return;
    const years = [];
    activeMapGeoJSON.features.forEach(f => {
      const siembra = f.properties?.SIEMBRA || f.properties?.siembra || f.properties?.Siembra;
      if (siembra) {
        const y = parseInt(siembra, 10);
        if (!isNaN(y) && y > 0) {
          years.push(y);
        }
      }
    });
    if (years.length > 0) {
      const avgSiembra = years.reduce((sum, y) => sum + y, 0) / years.length;
      const currentYear = new Date().getFullYear();
      const edadMedia = currentYear - avgSiembra;
      if (edadMedia > 0) {
        const idx = KC_ETAPAS.findIndex(e => edadMedia >= e.edadMin && edadMedia < e.edadMax);
        if (idx !== -1) {
          setKcEtapaIndex(idx);
          setKcCultivo(KC_ETAPAS[idx].kc);
        }
      }
    }
  }, [activeMapGeoJSON]);

  // Manejar subida de archivo Excel con Sincronización Automática
  const handleExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setSyncStatus('idle');
    setErrorMessage(null);
    
    try {
      // 1. Parser del Excel en memoria
      setLoadingSource('Procesando Excel...');
      const parsedData = await parseHistoricalExcel(file);
      if (parsedData.length === 0) {
        throw new Error("No se encontraron registros válidos en el archivo. Verifica las columnas.");
      }

      // Evitar duplicación de datos (filtrar por finca, pluviometro y fecha)
      const existingKeys = new Set(records.map(r => `${r.finca}|${r.pluviometro}|${r.data}`));
      const onlyNewRecords = parsedData.filter(r => !existingKeys.has(`${r.finca}|${r.pluviometro}|${r.data}`));

      if (onlyNewRecords.length === 0) {
        throw new Error("No se encontraron registros nuevos en el archivo Excel (todos los datos ya están registrados).");
      }

      // Combinar para formar la base consolidada local
      const combinedData = [...records, ...onlyNewRecords];

      // 2. Guardar en IndexedDB local
      setLoadingSource('Guardando en base local...');
      await saveHistoricalRecords(combinedData);
      setRecords(combinedData);

      // 3. Sincronizar automáticamente a Firebase Realtime Database (solo los registros nuevos)
      setSyncStatus('uploading');
      setSyncProgress(0);
      setSyncTotal(onlyNewRecords.length);
      
      await uploadRecords(onlyNewRecords, (processed) => {
        setSyncProgress(processed);
      });
      
      setSyncStatus('success');
      initializeFilters(combinedData);
      
      // Esperar 1.8s en pantalla de éxito y cerrar el modal
      setTimeout(() => {
        setSettingsOpen(false);
        setSyncStatus('idle');
      }, 1800);

    } catch (err) {
      setSyncStatus('error');
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
      setLoadingSource('');
    }
  };

  // Manejar subida de archivo GeoJSON de mapas SIG
  const handleMapUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMapUploadStatus('uploading');
    setMapUploadError(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const geojsonData = JSON.parse(text);

        if (!geojsonData || typeof geojsonData !== 'object') {
          throw new Error("El archivo no contiene un JSON válido.");
        }
        if (geojsonData.type !== 'FeatureCollection' || !Array.isArray(geojsonData.features)) {
          throw new Error("El formato no es un GeoJSON válido (debe ser una FeatureCollection).");
        }

        const fincaKey = FINCA_MAPS_KEYS[mapUploadFinca] || mapUploadFinca;

        // 1. Guardar localmente
        await saveLocalMap(fincaKey, geojsonData);

        // 2. Subir a Firebase Cloud
        await uploadMap(fincaKey, geojsonData);

        // 3. Actualizar estado reactivo
        setFincaMaps(prev => ({
          ...prev,
          [fincaKey]: geojsonData
        }));

        setMapUploadStatus('success');

        setTimeout(() => {
          setMapUploadStatus('idle');
        }, 2000);

      } catch (err) {
        setMapUploadStatus('error');
        setMapUploadError(err.message);
      }
    };

    reader.onerror = () => {
      setMapUploadStatus('error');
      setMapUploadError("Error de lectura del archivo.");
    };

    reader.readAsText(file);
  };

  // Manejar subida de archivo Excel de Suelos
  const handleSoilExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setSoilUploadStatus('idle');
    setSoilErrorMessage(null);

    try {
      setLoadingSource('Procesando archivo de suelos...');
      const parsedSoils = await parseSoilsExcel(file);
      if (parsedSoils.length === 0) {
        throw new Error("No se encontraron registros de suelos válidos en el archivo Excel.");
      }

      setLoadingSource('Guardando suelos localmente...');
      await saveSoilRecords(parsedSoils);
      setSoils(parsedSoils);

      // Sincronizar con Firebase Realtime Database
      setSoilUploadStatus('uploading');
      setSoilSyncProgress(0);
      setSoilSyncTotal(parsedSoils.length);

      await uploadSoilRecords(parsedSoils, (processed) => {
        setSoilSyncProgress(processed);
      });

      setSoilUploadStatus('success');

      setTimeout(() => {
        setSoilUploadStatus('idle');
      }, 2000);

    } catch (err) {
      setSoilUploadStatus('error');
      setSoilErrorMessage(err.message);
    } finally {
      setLoading(false);
      setLoadingSource('');
    }
  };

  // Limpiar datos de suelos
  const handleClearSoils = async () => {
    if (window.confirm("¿Estás seguro de que deseas eliminar toda la información de suelos localmente?")) {
      setLoading(true);
      try {
        await clearSoilRecords();
        setSoils([]);
      } catch (err) {
        alert("Error al limpiar datos de suelos: " + err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  // Limpiar datos en ambas bases (Local y Firebase Cloud)
  const handleClearData = async () => {
    if (window.confirm("¿Estás seguro de que deseas eliminar todos los datos de forma local y desactivar la base actual? (Nota: Los datos en Firebase permanecerán en la nube pero tu vista local se vaciará).")) {
      setLoading(true);
      try {
        await clearHistoricalRecords();
        setRecords([]);
        setSelectedFinca('');
        setSelectedPluviometro('');
        setSelectedAnio('');
      } catch (err) {
        alert("Error al limpiar IndexedDB: " + err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  // Manejar autenticación de Administrador
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const fbCreds = await getAdminCredentials();
      
      const expectedUser = fbCreds?.username || 'admin';
      const expectedPassword = fbCreds?.password || 'hlg2026#';

      if (loginUser === expectedUser && loginPassword === expectedPassword) {
        setIsAdminLoggedIn(true);
        sessionStorage.setItem('isAdminLoggedIn', 'true');
        setShowLoginModal(false);
        setSettingsOpen(true);
        setLoginUser('');
        setLoginPassword('');
      } else {
        setLoginError("Usuario o contraseña incorrectos.");
      }
    } catch (err) {
      console.error("Error en login:", err);
      // Fallback local en caso de error de conexión
      if (loginUser === 'admin' && loginPassword === 'hlg2026#') {
        setIsAdminLoggedIn(true);
        sessionStorage.setItem('isAdminLoggedIn', 'true');
        setShowLoginModal(false);
        setSettingsOpen(true);
        setLoginUser('');
        setLoginPassword('');
      } else {
        setLoginError("Error de conexión. Intenta de nuevo.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Abrir panel de configuración (o pedir login si no está autenticado)
  const handleOpenSettings = () => {
    if (isAdminLoggedIn) {
      setSettingsOpen(true);
    } else {
      setLoginError(null);
      setLoginUser('');
      setLoginPassword('');
      setShowLoginModal(true);
    }
  };

  const fetchTracksAndReadings = async () => {
    try {
      const cloudTracks = await downloadMobileTracks();
      setMobileTracks(cloudTracks);
      const cloudReadings = await downloadMobileReadings();
      setMobileReadings(cloudReadings);
    } catch (err) {
      console.warn("Error al descargar datos móviles en tiempo real:", err);
    }
  };

  // Alternar el estado de visualización de los recorridos móviles (Track)
  const handleToggleTrack = (active) => {
    setTrackActive(active);
    if (active) {
      fetchTracksAndReadings(); // Descargar datos de Firebase inmediatamente al activar el modo Track
      setSelectedMapFinca('01'); // Finca activa HLG (código 01)
      setSelectedMapPluviometro('Todos'); // Pluviómetros en todos
      setSelectedMapAnio('2026'); // Año en 2026
      setSelectedMapMes('Todos'); // Mes en todos
      setShowPluvZones(false); // Colores desactivados
      setHumDisplayMode('off'); // Humedad desactivado
      setSelectedLotInfo(null); // Limpiar lote seleccionado
      setSelectedTrackId(null); // Limpiar track seleccionado
      setPlaybackIndex(0); // Reiniciar animación
      setIsPlaying(false); // Pausar
    } else {
      setSelectedTrackId(null);
      setPlaybackIndex(0);
      setIsPlaying(false);
    }
  };

  // Efecto para la reproducción automática del recorrido GPS con interpolación suave
  useEffect(() => {
    let interval = null;
    if (isPlaying && selectedTrackId) {
      const track = getActiveTrack(selectedTrackId, mobileTracks, mobileReadings);
      if (track && track.recorrido && track.recorrido.length > 0) {
        interval = setInterval(() => {
          setInterpolationFactor(prevFactor => {
            const nextFactor = prevFactor + 0.05; // 40ms / 800ms = 0.05 por paso
            if (nextFactor >= 1) {
              setPlaybackIndex(prevIndex => {
                if (prevIndex >= track.recorrido.length - 2) {
                  // Llegamos al final del recorrido
                  setIsPlaying(false);
                  return track.recorrido.length - 1;
                }
                return prevIndex + 1;
              });
              return 0; // Reiniciar para el siguiente tramo
            }
            return nextFactor;
          });
        }, 40); // 25 FPS para un deslizamiento suave y continuo
      } else {
        setIsPlaying(false);
      }
    } else {
      setInterpolationFactor(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, selectedTrackId, mobileTracks]);

  // Listado de fincas únicas
  const uniqueFincas = useMemo(() => {
    return [...new Set(records.map(r => r.finca))].sort();
  }, [records]);

  // Al cambiar la finca seleccionada, resetear pluviómetro y año o validar pertinencia
  useEffect(() => {
    if (records.length > 0 && selectedFinca) {
      if (selectedFinca === 'Todas') {
        if (!selectedPluviometro) {
          setSelectedPluviometro('Todos');
        }
      } else {
        const pluviometrosDeFinca = [...new Set(records.filter(r => r.finca === selectedFinca).map(r => r.pluviometro))].sort();
        if (pluviometrosDeFinca.length === 1) {
          setSelectedPluviometro(pluviometrosDeFinca[0]);
        } else if (selectedPluviometro !== 'Todos' && !pluviometrosDeFinca.includes(selectedPluviometro)) {
          setSelectedPluviometro('Todos');
        }
      }
    }
  }, [selectedFinca, records, selectedPluviometro]);

  // Pluviómetros únicos de la finca seleccionada
  const uniquePluviometros = useMemo(() => {
    if (!selectedFinca) return [];
    if (selectedFinca === 'Todas') {
      return [...new Set(records.map(r => r.pluviometro))].sort();
    }
    return [...new Set(records.filter(r => r.finca === selectedFinca).map(r => r.pluviometro))].sort();
  }, [records, selectedFinca]);

  // Años únicos de la finca y pluviómetro seleccionados
  const uniqueAnios = useMemo(() => {
    if (!selectedFinca || !selectedPluviometro) return [];
    
    let filtered = records;
    if (selectedFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === selectedFinca);
    }
    if (selectedPluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === selectedPluviometro);
    }

    return [...new Set(filtered.map(r => r.anio))].sort((a, b) => b - a);
  }, [records, selectedFinca, selectedPluviometro]);

  // Auto-seleccionar primer año al cambiar pluviómetro
  useEffect(() => {
    if (uniqueAnios.length > 0 && selectedAnio !== 'Todos' && !uniqueAnios.includes(parseInt(selectedAnio))) {
      setSelectedAnio(String(uniqueAnios[0]));
    }
  }, [uniqueAnios, selectedAnio]);

  // Meses únicos del año, finca y pluviómetro seleccionados
  const uniqueMeses = useMemo(() => {
    if (!selectedFinca || !selectedPluviometro || !selectedAnio) return [];
    
    let filtered = records;
    if (selectedAnio !== 'Todos') {
      filtered = filtered.filter(r => String(r.anio) === selectedAnio);
    }
    
    if (selectedFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === selectedFinca);
    }
    if (selectedPluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === selectedPluviometro);
    }

    const monthsMap = {};
    filtered.forEach(r => {
      if (r.mes) {
        monthsMap[r.mes] = r.mesDesc || `Mes ${r.mes}`;
      }
    });
    
    return Object.keys(monthsMap)
      .map(m => ({ value: m, label: monthsMap[m] }))
      .sort((a, b) => parseInt(a.value) - parseInt(b.value));
  }, [records, selectedFinca, selectedPluviometro, selectedAnio]);

  // Resetear mes al cambiar finca, pluviómetro o año
  useEffect(() => {
    setSelectedMes('Todos');
  }, [selectedFinca, selectedPluviometro, selectedAnio]);

  // Memos y Efectos independientes para los filtros de la pestaña Mapas
  const uniqueMapPluviometros = useMemo(() => {
    if (records.length === 0) return [];
    if (!selectedMapFinca || selectedMapFinca === 'Todas') {
      return [...new Set(records.map(r => r.pluviometro))].sort();
    }
    return [...new Set(records.filter(r => r.finca === selectedMapFinca).map(r => r.pluviometro))].sort();
  }, [records, selectedMapFinca]);

  const uniqueMapAnios = useMemo(() => {
    if (records.length === 0) return [];
    let filtered = records;
    if (selectedMapFinca && selectedMapFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === selectedMapFinca);
    }
    if (selectedMapPluviometro && selectedMapPluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === selectedMapPluviometro);
    }
    return [...new Set(filtered.map(r => r.anio))].sort((a, b) => b - a);
  }, [records, selectedMapFinca, selectedMapPluviometro]);

  const uniqueMapMeses = useMemo(() => {
    if (!selectedMapFinca || !selectedMapPluviometro || !selectedMapAnio) return [];
    let filtered = records;
    if (selectedMapAnio !== 'Todos') {
      filtered = filtered.filter(r => String(r.anio) === selectedMapAnio);
    }
    if (selectedMapFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === selectedMapFinca);
    }
    if (selectedMapPluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === selectedMapPluviometro);
    }

    const monthsMap = {};
    filtered.forEach(r => {
      if (r.mes) {
        monthsMap[r.mes] = r.mesDesc || `Mes ${r.mes}`;
      }
    });
    
    return Object.keys(monthsMap)
      .map(m => ({ value: m, label: monthsMap[m] }))
      .sort((a, b) => parseInt(a.value) - parseInt(b.value));
  }, [records, selectedMapFinca, selectedMapPluviometro, selectedMapAnio]);

  // Al cambiar finca de mapa, reiniciar o validar pluviómetro de mapa
  useEffect(() => {
    if (records.length > 0 && selectedMapFinca) {
      if (selectedMapFinca === 'Todas') {
        if (!selectedMapPluviometro) {
          setSelectedMapPluviometro('Todos');
        }
      } else {
        const pluvs = [...new Set(records.filter(r => r.finca === selectedMapFinca).map(r => r.pluviometro))].sort();
        if (pluvs.length === 1) {
          setSelectedMapPluviometro(pluvs[0]);
        } else if (selectedMapPluviometro !== 'Todos' && !pluvs.includes(selectedMapPluviometro)) {
          setSelectedMapPluviometro('Todos');
        }
      }
    }
  }, [selectedMapFinca, records, selectedMapPluviometro]);

  // Al cambiar pluviómetro de mapa, auto-seleccionar primer año disponible si es necesario
  useEffect(() => {
    if (uniqueMapAnios.length > 0 && selectedMapAnio !== 'Todos' && !uniqueMapAnios.includes(parseInt(selectedMapAnio))) {
      setSelectedMapAnio(String(uniqueMapAnios[0]));
    }
  }, [uniqueMapAnios, selectedMapAnio]);

  // Resetear mes de mapa al cambiar filtros
  useEffect(() => {
    setSelectedMapMes('Todos');
  }, [selectedMapFinca, selectedMapPluviometro, selectedMapAnio]);

  // Memos y Efectos independientes para los filtros y datos de la pestaña de Balance
  const uniqueBalanceFincas = useMemo(() => {
    return [...new Set(records.map(r => r.finca))].sort();
  }, [records]);

  const uniqueBalancePluviometros = useMemo(() => {
    if (records.length === 0) return [];
    if (!selectedBalanceFinca || selectedBalanceFinca === 'Todas') {
      return [...new Set(records.map(r => r.pluviometro))].sort();
    }
    return [...new Set(records.filter(r => r.finca === selectedBalanceFinca).map(r => r.pluviometro))].sort();
  }, [records, selectedBalanceFinca]);

  // Años únicos independientes para la pestaña de Balance
  const uniqueBalanceAnios = useMemo(() => {
    if (records.length === 0) return [];
    let filtered = records;
    if (selectedBalanceFinca && selectedBalanceFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === selectedBalanceFinca);
    }
    if (selectedBalancePluviometro && selectedBalancePluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === selectedBalancePluviometro);
    }
    return [...new Set(filtered.map(r => r.anio))].sort((a, b) => b - a);
  }, [records, selectedBalanceFinca, selectedBalancePluviometro]);

  // Al cambiar filtros de balance, auto-seleccionar primer año disponible
  useEffect(() => {
    if (uniqueBalanceAnios.length > 0) {
      if (!selectedBalanceAnio || !uniqueBalanceAnios.includes(parseInt(selectedBalanceAnio))) {
        setSelectedBalanceAnio(String(uniqueBalanceAnios[0]));
      }
    } else {
      setSelectedBalanceAnio('');
    }
  }, [uniqueBalanceAnios, selectedBalanceAnio]);

  // Seleccionar la primera finca disponible cuando carguen los datos (HLG=01 de preferencia)
  useEffect(() => {
    if (records.length > 0 && (!selectedBalanceFinca || selectedBalanceFinca === 'Todas')) {
      const fincas = [...new Set(records.map(r => r.finca))].sort();
      // Preferir '01' (HLG), si no existe usar la primera disponible
      const defaultFinca = fincas.includes('01') ? '01' : fincas[0];
      if (defaultFinca) setSelectedBalanceFinca(defaultFinca);
    }
  }, [records]);

  // Al cambiar finca de balance, reiniciar o validar pluviómetro de balance
  useEffect(() => {
    if (records.length > 0 && selectedBalanceFinca) {
      if (selectedBalanceFinca === 'Todas') {
        if (!selectedBalancePluviometro) {
          setSelectedBalancePluviometro('Todos');
        }
      } else {
        const pluvs = [...new Set(records.filter(r => r.finca === selectedBalanceFinca).map(r => r.pluviometro))].sort();
        if (pluvs.length === 1) {
          setSelectedBalancePluviometro(pluvs[0]);
        } else if (selectedBalancePluviometro !== 'Todos' && !pluvs.includes(selectedBalancePluviometro)) {
          setSelectedBalancePluviometro('Todos');
        }
      }
    }
  }, [selectedBalanceFinca, records, selectedBalancePluviometro]);

  const balanceTableData = useMemo(() => {
    if (records.length === 0) return [];

    // 1. Obtener la cantidad de pluviómetros por finca de toda la base
    const pluvsByFinca = {};
    records.forEach(r => {
      if (!pluvsByFinca[r.finca]) pluvsByFinca[r.finca] = new Set();
      pluvsByFinca[r.finca].add(r.pluviometro);
    });
    const pluvCountByFinca = {};
    Object.keys(pluvsByFinca).forEach(f => {
      pluvCountByFinca[f] = pluvsByFinca[f].size;
    });

    // 2. Agrupar la precipitación por año, mes, finca y pluviómetro
    const grouped = {};
    records.forEach(r => {
      const y = r.anio;
      const m = r.mes;
      const f = r.finca;
      const p = r.pluviometro;
      if (!grouped[y]) grouped[y] = {};
      if (!grouped[y][m]) grouped[y][m] = {};
      if (!grouped[y][m][f]) grouped[y][m][f] = {};
      
      grouped[y][m][f][p] = (grouped[y][m][f][p] || 0) + r.prec;
    });

    // Orden descendente: año más reciente primero
    const years = [...new Set(records.map(r => r.anio))].sort((a, b) => b - a);
    const isSpecificPluv = selectedBalancePluviometro && selectedBalancePluviometro !== 'Todos';

    return years.map(year => {
      const months = Array.from({ length: 12 }, () => 0);
      let yearTotal = 0;

      for (let m = 1; m <= 12; m++) {
        let val = 0;

        if (isSpecificPluv) {
          if (selectedBalanceFinca !== 'Todas') {
            val = grouped[year]?.[m]?.[selectedBalanceFinca]?.[selectedBalancePluviometro] || 0;
          } else {
            let sum = 0;
            Object.keys(FINCA_NAMES).forEach(fKey => {
              if (fKey === '01' || fKey === '02' || fKey === '03') {
                sum += grouped[year]?.[m]?.[fKey]?.[selectedBalancePluviometro] || 0;
              }
            });
            val = sum;
          }
        } else {
          if (selectedBalanceFinca !== 'Todas') {
            let sum = 0;
            const pluvs = pluvsByFinca[selectedBalanceFinca] ? Array.from(pluvsByFinca[selectedBalanceFinca]) : [];
            pluvs.forEach(p => {
              sum += grouped[year]?.[m]?.[selectedBalanceFinca]?.[p] || 0;
            });
            const count = pluvCountByFinca[selectedBalanceFinca] || 1;
            val = sum / count;
          } else {
            let sum = 0;
            Object.keys(FINCA_NAMES).forEach(fKey => {
              if (fKey === '01' || fKey === '02' || fKey === '03') {
                let fincaSum = 0;
                const pluvs = pluvsByFinca[fKey] ? Array.from(pluvsByFinca[fKey]) : [];
                pluvs.forEach(p => {
                  fincaSum += grouped[year]?.[m]?.[fKey]?.[p] || 0;
                });
                const count = pluvCountByFinca[fKey] || 1;
                sum += fincaSum / count;
              }
            });
            val = sum;
          }
        }

        months[m - 1] = val;
        yearTotal += val;
      }

      return {
        year,
        months,
        total: yearTotal
      };
    });
  }, [records, selectedBalanceFinca, selectedBalancePluviometro]);

  // Sincronizar y validar años de comparación con años disponibles
  useEffect(() => {
    if (uniqueAnios.length > 0) {
      const validSelections = selectedCompareAnios.filter(yr => uniqueAnios.includes(yr));
      if (validSelections.length === 0) {
        // Pre-seleccionar año activo + el anterior si está disponible
        const currentActive = parseInt(selectedAnio, 10);
        if (uniqueAnios.includes(currentActive)) {
          const secondYear = uniqueAnios.find(y => y !== currentActive);
          setSelectedCompareAnios(secondYear ? [currentActive, secondYear].sort((a, b) => a - b) : [currentActive]);
        } else {
          // Si el año activo es "Todos", pre-seleccionar los dos más recientes en orden cronológico
          setSelectedCompareAnios(uniqueAnios.slice(0, 2).reverse());
        }
      } else {
        setSelectedCompareAnios(validSelections);
      }
    } else {
      setSelectedCompareAnios([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueAnios, selectedAnio]);

  // Generar datos para el gráfico comparativo anual
  const compareChartData = useMemo(() => {
    // Obtener totales mensuales de precipitación para un año específico
    const getMonthlyTotalsForYear = (year) => {
      const matrix = Array.from({ length: 12 }, () => Array.from({ length: 31 }, () => 0));

      const pluvsByFinca = {};
      records.forEach(r => {
        if (!pluvsByFinca[r.finca]) pluvsByFinca[r.finca] = new Set();
        pluvsByFinca[r.finca].add(r.pluviometro);
      });
      const pluvCountByFinca = {};
      Object.keys(pluvsByFinca).forEach(f => {
        pluvCountByFinca[f] = pluvsByFinca[f].size;
      });

      let yearRecords = records.filter(r => r.anio === year);

      if (selectedFinca && selectedFinca !== 'Todas') {
        yearRecords = yearRecords.filter(r => r.finca === selectedFinca);
      }

      const isSpecificPluv = selectedPluviometro && selectedPluviometro !== 'Todos';
      if (isSpecificPluv) {
        yearRecords = yearRecords.filter(r => r.pluviometro === selectedPluviometro);
      }

      const grouped = {};
      yearRecords.forEach(r => {
        const key = `${r.finca}_${r.pluviometro}_${r.mes}_${r.dia}`;
        grouped[key] = (grouped[key] || 0) + r.prec;
      });

      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          if (isSpecificPluv) {
            if (selectedFinca !== 'Todas') {
              const key = `${selectedFinca}_${selectedPluviometro}_${m}_${d}`;
              matrix[m - 1][d - 1] = grouped[key] || 0;
            } else {
              let daySum = 0;
              Object.keys(FINCA_NAMES).forEach(fKey => {
                const key = `${fKey}_${selectedPluviometro}_${m}_${d}`;
                daySum += grouped[key] || 0;
              });
              matrix[m - 1][d - 1] = daySum;
            }
          } else {
            if (selectedFinca !== 'Todas') {
              let daySum = 0;
              const pluvs = pluvsByFinca[selectedFinca] ? Array.from(pluvsByFinca[selectedFinca]) : [];
              pluvs.forEach(p => {
                const key = `${selectedFinca}_${p}_${m}_${d}`;
                daySum += grouped[key] || 0;
              });
              const count = pluvCountByFinca[selectedFinca] || 1;
              matrix[m - 1][d - 1] = daySum / count;
            } else {
              let daySum = 0;
              Object.keys(FINCA_NAMES).forEach(fKey => {
                let fincaSum = 0;
                const pluvs = pluvsByFinca[fKey] ? Array.from(pluvsByFinca[fKey]) : [];
                pluvs.forEach(p => {
                  const key = `${fKey}_${p}_${m}_${d}`;
                  fincaSum += grouped[key] || 0;
                });
                const count = pluvCountByFinca[fKey] || 1;
                daySum += fincaSum / count;
              });
              matrix[m - 1][d - 1] = daySum;
            }
          }
        }
      }

      const rowTotals = [];
      for (let m = 0; m < 12; m++) {
        let monthSum = 0;
        for (let d = 0; d < 31; d++) {
          monthSum += matrix[m][d];
        }
        rowTotals.push(monthSum);
      }

      return rowTotals;
    };

    const yearColors = [
      { bg: 'rgba(0, 242, 254, 0.75)', border: '#00f2fe' },       // Cyan
      { bg: 'rgba(79, 172, 254, 0.75)', border: '#4facfe' },       // Blue
      { bg: 'rgba(0, 255, 135, 0.75)', border: '#00ff87' },       // Emerald Green
      { bg: 'rgba(255, 140, 0, 0.75)', border: '#ff8c00' },       // Orange
      { bg: 'rgba(243, 85, 136, 0.75)', border: '#f35588' },       // Pink
      { bg: 'rgba(161, 140, 209, 0.75)', border: '#a18cd1' }       // Purple
    ];

    const datasets = selectedCompareAnios.map((year, index) => {
      const color = yearColors[index % yearColors.length];
      const monthlyTotals = getMonthlyTotalsForYear(year);
      const isLine = compareChartType === 'line';

      return {
        type: compareChartType,
        label: `Año ${year}`,
        data: monthlyTotals,
        backgroundColor: isLine ? 'rgba(255, 255, 255, 0.05)' : color.bg,
        borderColor: color.border,
        borderWidth: isLine ? 3 : 1.5,
        borderRadius: isLine ? 0 : 4,
        tension: isLine ? 0.35 : 0,
        fill: false,
        pointBackgroundColor: isLine ? '#ffffff' : color.bg,
        pointBorderColor: color.border,
        pointBorderWidth: isLine ? 2 : 1,
        pointRadius: isLine ? 4 : 0,
        pointHoverRadius: isLine ? 6 : 0,
        yAxisID: 'y'
      };
    });

    return {
      labels: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
      datasets
    };
  }, [selectedCompareAnios, records, selectedFinca, selectedPluviometro, compareChartType]);

  // Opciones para el gráfico comparativo (sin eje y1 / eventos)
  const compareChartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 15
        }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: 'rgba(255, 255, 255, 0.8)',
            font: {
              family: 'Outfit, sans-serif',
              size: 12,
              weight: '500'
            },
            padding: 20
          }
        },
        tooltip: {
          backgroundColor: 'rgba(10, 15, 30, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          cornerRadius: 8,
          titleFont: {
            family: 'Outfit, sans-serif',
            weight: 'bold',
            size: 13
          },
          bodyFont: {
            family: 'Inter, sans-serif',
            size: 12
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.6)',
            font: {
              family: 'Inter, sans-serif',
              size: 11
            }
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grace: '10%',
          title: {
            display: true,
            text: 'Precipitación (mm)',
            color: 'rgba(0, 242, 254, 0.9)',
            font: {
              family: 'Outfit, sans-serif',
              size: 12,
              weight: '600'
            }
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.6)',
            font: {
              family: 'Inter, sans-serif'
            }
          }
        }
      }
    };
  }, []);

  // Generar datos para el gráfico de balance hídrico mensual
  const balanceChartData = useMemo(() => {
    if (!selectedBalanceAnio || balanceTableData.length === 0) {
      return {
        labels: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
        datasets: []
      };
    }

    const selectedYearInt = parseInt(selectedBalanceAnio, 10);
    const selectedYearData = balanceTableData.find(row => row.year === selectedYearInt);
    const precipDataRaw = selectedYearData ? selectedYearData.months : Array.from({ length: 12 }, () => 0);

    // Evapotranspiración mensual
    const DAYS_PER_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (selectedYearInt % 4 === 0 && (selectedYearInt % 100 !== 0 || selectedYearInt % 400 === 0)) {
      DAYS_PER_MONTH[1] = 29; // bisiesto
    }
    const etMonthly = DAYS_PER_MONTH.map(d => etcEfectiva * d);

    // Determinar el último año y mes con datos en la base para esta finca/pluviómetro
    let dbMaxYear = 0;
    let dbMaxMonth = 0;
    let filteredFinca = records.filter(r => r.finca === selectedBalanceFinca);
    if (selectedBalancePluviometro && selectedBalancePluviometro !== 'Todos') {
      filteredFinca = filteredFinca.filter(r => r.pluviometro === selectedBalancePluviometro);
    }
    filteredFinca.forEach(r => {
      if (r.anio > dbMaxYear) {
        dbMaxYear = r.anio;
        dbMaxMonth = r.mes;
      } else if (r.anio === dbMaxYear) {
        if (r.mes > dbMaxMonth) {
          dbMaxMonth = r.mes;
        }
      }
    });

    let maxActiveMonth = 0;
    if (selectedYearInt < dbMaxYear) {
      maxActiveMonth = 12;
    } else if (selectedYearInt === dbMaxYear) {
      maxActiveMonth = dbMaxMonth;
    }

    const finalPrecipData = precipDataRaw.map((val, idx) => {
      const monthNum = idx + 1;
      return monthNum <= maxActiveMonth ? val : null;
    });

    const finalEtData = etMonthly.map((val, idx) => {
      const monthNum = idx + 1;
      return monthNum <= maxActiveMonth ? val : null;
    });

    const isLine = balanceChartType === 'line';

    const datasets = [
        {
          type: balanceChartType,
          label: 'Precipitación Efectiva',
          data: finalPrecipData,
          backgroundColor: isLine ? 'rgba(0, 242, 254, 0.03)' : 'rgba(0, 242, 254, 0.75)',
          borderColor: '#00f2fe',
          borderWidth: isLine ? 3 : 1.5,
          borderRadius: isLine ? 0 : 4,
          tension: isLine ? 0.35 : 0,
          pointStyle: 'line',
          fill: isLine ? {
            target: '1',
            above: (context) => {
              const { ctx } = context.chart;
              if (!showHatching) return 'transparent';
              if (!ctx) return 'transparent';
              
              const pCanvas = document.createElement('canvas');
              pCanvas.width = 6;
              pCanvas.height = 6;
              const pCtx = pCanvas.getContext('2d');
              if (!pCtx) return 'transparent';
              
              pCtx.fillStyle = 'rgba(0, 242, 254, 0.03)';
              pCtx.fillRect(0, 0, 6, 6);
              pCtx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
              pCtx.lineWidth = 1.2;
              pCtx.beginPath();
              pCtx.moveTo(0, 6);
              pCtx.lineTo(6, 0);
              pCtx.stroke();
              
              return ctx.createPattern(pCanvas, 'repeat');
            },
            below: (context) => {
              const { ctx } = context.chart;
              if (!showHatching) return 'transparent';
              if (!ctx) return 'transparent';
              
              const pCanvas = document.createElement('canvas');
              pCanvas.width = 6;
              pCanvas.height = 6;
              const pCtx = pCanvas.getContext('2d');
              if (!pCtx) return 'transparent';
              
              pCtx.fillStyle = 'rgba(255, 75, 75, 0.03)';
              pCtx.fillRect(0, 0, 6, 6);
              pCtx.strokeStyle = 'rgba(255, 75, 75, 0.5)';
              pCtx.lineWidth = 1.2;
              pCtx.beginPath();
              pCtx.moveTo(0, 6);
              pCtx.lineTo(6, 0);
              pCtx.stroke();
              
              return ctx.createPattern(pCanvas, 'repeat');
            }
          } : false,
          pointBackgroundColor: isLine ? '#ffffff' : '#00f2fe',
          pointBorderColor: '#00f2fe',
          pointBorderWidth: isLine ? 2 : 1,
          pointRadius: isLine ? 4 : 0,
          pointHoverRadius: isLine ? 6 : 0,
          spanGaps: false
        },
        {
          type: balanceChartType,
          label: 'Evapotranspiración',
          data: finalEtData,
          backgroundColor: isLine ? 'rgba(253, 203, 110, 0.03)' : 'rgba(253, 203, 110, 0.75)',
          borderColor: '#ffd166',
          borderWidth: isLine ? 3 : 1.5,
          borderRadius: isLine ? 0 : 4,
          tension: isLine ? 0.35 : 0,
          pointStyle: 'line',
          fill: false,
          pointBackgroundColor: isLine ? '#ffffff' : '#ffd166',
          pointBorderColor: '#ffd166',
          pointBorderWidth: isLine ? 2 : 1,
          pointRadius: isLine ? 4 : 0,
          pointHoverRadius: isLine ? 6 : 0,
          spanGaps: false
        }
    ];

    if (showHatching) {
      datasets.push(
        {
          type: 'line',
          label: 'Déficit',
          data: [],
          borderColor: '#ff4b4b',
          backgroundColor: (context) => {
            const { ctx } = context.chart;
            if (!showHatching) return 'rgba(255, 75, 75, 0.18)';
            if (!ctx) return 'rgba(255, 75, 75, 0.18)';
            
            const pCanvas = document.createElement('canvas');
            pCanvas.width = 6;
            pCanvas.height = 6;
            const pCtx = pCanvas.getContext('2d');
            if (!pCtx) return 'rgba(255, 75, 75, 0.18)';
            pCtx.fillStyle = 'rgba(255, 75, 75, 0.03)';
            pCtx.fillRect(0, 0, 6, 6);
            pCtx.strokeStyle = 'rgba(255, 75, 75, 0.5)';
            pCtx.lineWidth = 1.2;
            pCtx.beginPath();
            pCtx.moveTo(0, 6);
            pCtx.lineTo(6, 0);
            pCtx.stroke();
            return ctx.createPattern(pCanvas, 'repeat');
          },
          borderWidth: 1.5,
          pointRadius: 0,
          pointStyle: 'rect',
          fill: false
        },
        {
          type: 'line',
          label: 'Exceso',
          data: [],
          borderColor: '#00f2fe',
          backgroundColor: (context) => {
            const { ctx } = context.chart;
            if (!showHatching) return 'rgba(0, 242, 254, 0.18)';
            if (!ctx) return 'rgba(0, 242, 254, 0.18)';
            
            const pCanvas = document.createElement('canvas');
            pCanvas.width = 6;
            pCanvas.height = 6;
            const pCtx = pCanvas.getContext('2d');
            if (!pCtx) return 'rgba(0, 242, 254, 0.18)';
            pCtx.fillStyle = 'rgba(0, 242, 254, 0.03)';
            pCtx.fillRect(0, 0, 6, 6);
            pCtx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
            pCtx.lineWidth = 1.2;
            pCtx.beginPath();
            pCtx.moveTo(0, 6);
            pCtx.lineTo(6, 0);
            pCtx.stroke();
            return ctx.createPattern(pCanvas, 'repeat');
          },
          borderWidth: 1.5,
          pointRadius: 0,
          pointStyle: 'rect',
          fill: false
        }
      );
    }

    return {
      labels: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
      datasets
    };
  }, [balanceTableData, selectedBalanceAnio, balanceChartType, etcEfectiva, records, selectedBalanceFinca, selectedBalancePluviometro, showHatching]);

  const balanceChartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 15
        }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            boxHeight: 10,
            color: 'rgba(255, 255, 255, 0.8)',
            font: {
              family: 'Outfit, sans-serif',
              size: 12,
              weight: '500'
            },
            padding: 20
          }
        },
        tooltip: {
          backgroundColor: 'rgba(10, 15, 30, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          cornerRadius: 8,
          titleFont: {
            family: 'Outfit, sans-serif',
            weight: 'bold',
            size: 13
          },
          bodyFont: {
            family: 'Inter, sans-serif',
            size: 12
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.6)',
            font: {
              family: 'Inter, sans-serif',
              size: 11
            }
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grace: '10%',
          title: {
            display: true,
            text: 'Milímetros (mm)',
            color: 'rgba(0, 242, 254, 0.9)',
            font: {
              family: 'Outfit, sans-serif',
              size: 12,
              weight: '600'
            }
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.6)',
            font: {
              family: 'Inter, sans-serif'
            }
          }
        }
      }
    };
  }, []);

  const reservaCurveData = useMemo(() => {
    if (!selectedBalanceAnio || balanceTableData.length === 0) return null;

    const selectedYearInt = parseInt(selectedBalanceAnio, 10);
    const selectedYearData = balanceTableData.find(row => row.year === selectedYearInt);
    if (!selectedYearData) return null;

    const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (selectedYearInt % 4 === 0 && (selectedYearInt % 100 !== 0 || selectedYearInt % 400 === 0)) {
      DAYS_PER_MONTH[1] = 29;
    }

    const etcMensual = DAYS_PER_MONTH.map(d => etcEfectiva * d);
    const precipData = selectedYearData.months;

    let reserva = capacidadSuelo;
    const meses = [];
    const conteoNiveles = { 'Óptimo': 0, 'Atención': 0, 'Estrés': 0, 'Estrés Severo': 0 };
    let worstLevelIndex = 0;

    for (let m = 0; m < 12; m++) {
      const prec = precipData[m] || 0;
      const etcMes = etcMensual[m];
      const balance = prec - etcMes;
      
      let nuevaReserva = reserva + balance;
      let escurrimiento = Math.max(0, nuevaReserva - capacidadSuelo);
      nuevaReserva = Math.min(capacidadSuelo, nuevaReserva);
      
      let deficit = Math.max(0, -nuevaReserva);
      nuevaReserva = Math.max(0, nuevaReserva);
      reserva = nuevaReserva;

      const pct = capacidadSuelo > 0 ? (reserva / capacidadSuelo) * 100 : 0;
      const nivel = getNivelEstres(reserva, capacidadSuelo);
      
      conteoNiveles[nivel.label] = (conteoNiveles[nivel.label] || 0) + 1;
      const lvlIdx = ESTRES_NIVELES.indexOf(nivel);
      if (lvlIdx > worstLevelIndex) {
        worstLevelIndex = lvlIdx;
      }

      meses.push({
        mes: m,
        reserva,
        pct,
        nivel,
        prec,
        etcMes,
        balance,
        escurrimiento,
        deficit
      });
    }

    return {
      meses,
      conteoNiveles,
      nivelGlobal: ESTRES_NIVELES[worstLevelIndex]
    };
  }, [balanceTableData, selectedBalanceAnio, etcEfectiva, capacidadSuelo]);

  const spiData = useMemo(() => {
    if (balanceTableData.length < 5) {
      return { insuficiente: true, añosDisponibles: balanceTableData.length };
    }

    const annualPrecip = balanceTableData.map(row => {
      const sum = row.months.reduce((acc, val) => acc + val, 0);
      return { year: row.year, total: sum, months: row.months };
    });

    const totals = annualPrecip.map(ap => ap.total);
    const count = totals.length;
    const mean = totals.reduce((acc, val) => acc + val, 0) / count;
    
    const sqDiffs = totals.map(val => Math.pow(val - mean, 2));
    const variance = sqDiffs.reduce((acc, val) => acc + val, 0) / count;
    const stdDev = Math.sqrt(variance);

    const tablaAnual = annualPrecip.map(ap => {
      const spi12 = stdDev > 0 ? (ap.total - mean) / stdDev : 0;
      const categoria = getSPICategoria(spi12);
      const diferencia = ap.total - mean;
      const pct = mean > 0 ? (diferencia / mean) * 100 : 0;
      return {
        year: ap.year,
        precAnual: ap.total,
        media: mean,
        diferencia,
        pct,
        spi12,
        categoria
      };
    });

    tablaAnual.sort((a, b) => b.year - a.year);

    const selectedYearInt = parseInt(selectedBalanceAnio, 10);
    const selectedYearAP = annualPrecip.find(ap => ap.year === selectedYearInt);

    let añoActualData = null;
    let mensual = [];

    if (selectedYearAP) {
      const annualRow = tablaAnual.find(ta => ta.year === selectedYearInt);
      añoActualData = annualRow;

      const getMonthPrecip = (year, monthIdx) => {
        let targetYear = year;
        let targetMonthIdx = monthIdx;
        if (monthIdx < 0) {
          targetYear = year - 1;
          targetMonthIdx = 12 + monthIdx;
        }
        const yData = annualPrecip.find(ap => ap.year === targetYear);
        if (yData) {
          return yData.months[targetMonthIdx] || 0;
        }
        return 0;
      };

      for (let m = 0; m < 12; m++) {
        const p0 = selectedYearAP.months[m] || 0;
        const p1 = getMonthPrecip(selectedYearInt, m - 1);
        const p2 = getMonthPrecip(selectedYearInt, m - 2);
        const suma3m_actual = p0 + p1 + p2;

        const series3m = annualPrecip.map(ap => {
          const ap_p0 = ap.months[m] || 0;
          const ap_p1 = getMonthPrecip(ap.year, m - 1);
          const ap_p2 = getMonthPrecip(ap.year, m - 2);
          return ap_p0 + ap_p1 + ap_p2;
        });

        const sum3m_mean = series3m.reduce((acc, val) => acc + val, 0) / series3m.length;
        const sum3m_sqDiffs = series3m.map(val => Math.pow(val - sum3m_mean, 2));
        const sum3m_variance = sum3m_sqDiffs.reduce((acc, val) => acc + val, 0) / series3m.length;
        const sum3m_stdDev = Math.sqrt(sum3m_variance);

        const spi3 = sum3m_stdDev > 0 ? (suma3m_actual - sum3m_mean) / sum3m_stdDev : 0;
        const categoria = getSPICategoria(spi3);

        mensual.push({
          mes: m,
          spi3,
          categoria,
          prec3meses: suma3m_actual,
          media3meses: sum3m_mean
        });
      }
    }

    return {
      insuficiente: false,
      añosDisponibles: count,
      tablaAnual,
      mensual,
      añoActual: añoActualData
    };
  }, [balanceTableData, selectedBalanceAnio]);

  // Filtrar registros y calcular balance hídrico acumulado
  const processedData = useMemo(() => {
    if (!selectedFinca || !selectedPluviometro || !selectedAnio) return [];
    
    // 1. Filtrado en base a filtros
    let rawFiltered = records;
    if (selectedAnio !== 'Todos') {
      rawFiltered = rawFiltered.filter(r => String(r.anio) === selectedAnio);
    }

    if (selectedFinca !== 'Todas') {
      rawFiltered = rawFiltered.filter(r => r.finca === selectedFinca);
    }
    
    if (selectedPluviometro !== 'Todos') {
      rawFiltered = rawFiltered.filter(r => r.pluviometro === selectedPluviometro);
    }

    if (selectedMes !== 'Todos') {
      rawFiltered = rawFiltered.filter(r => String(r.mes) === selectedMes);
    }

    if (rawFiltered.length === 0) return [];

    // 2. Si es un único pluviómetro y finca, calcular directo
    if (selectedFinca !== 'Todas' && selectedPluviometro !== 'Todos') {
      return calculateWaterBalance(rawFiltered, etcEfectiva, capacidadSuelo, selectedAnio, selectedMes);
    }

    // 3. Multi-estaciones: Calcular balance hídrico individual por cada estación por separado,
    // y luego promediar los resultados por día para visualizarlos juntos.
    const groups = {};
    rawFiltered.forEach(r => {
      const key = `${r.finca}-${r.pluviometro}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    const calculatedGroups = Object.keys(groups).map(key => {
      return calculateWaterBalance(groups[key], etcEfectiva, capacidadSuelo, selectedAnio, selectedMes);
    });

    const allCalculated = calculatedGroups.flat();

    // Agrupar por fecha y promediar
    const dateGroups = {};
    allCalculated.forEach(r => {
      if (!dateGroups[r.data]) {
        dateGroups[r.data] = {
          data: r.data,
          semana: r.semana,
          finca: selectedFinca === 'Todas' ? 'Varias' : r.finca,
          pluviometro: selectedPluviometro === 'Todos' ? 'Varios' : r.pluviometro,
          prec: 0,
          balanceDiario: 0,
          balanceAcumulado: 0,
          escurrimiento: 0,
          deficit: 0,
          count: 0,
          anio: r.anio,
          mes: r.mes,
          mesDesc: r.mesDesc
        };
      }
      const dg = dateGroups[r.data];
      dg.prec += r.prec;
      dg.balanceDiario += r.balanceDiario;
      dg.balanceAcumulado += r.balanceAcumulado;
      dg.escurrimiento += r.escurrimiento;
      dg.deficit += r.deficit;
      dg.count += 1;
    });

    const result = Object.values(dateGroups).map(dg => {
      return {
        ...dg,
        prec: dg.prec / dg.count,
        balanceDiario: dg.balanceDiario / dg.count,
        balanceAcumulado: dg.balanceAcumulado / dg.count,
        escurrimiento: dg.escurrimiento / dg.count,
        deficit: dg.deficit / dg.count,
        id: `agg-${dg.data}-${selectedFinca}-${selectedPluviometro}`
      };
    });

    // Ordenar cronológicamente
    return result.sort((a, b) => {
      const parseDate = (dStr) => {
        const parts = dStr.split('/');
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      return parseDate(a.data) - parseDate(b.data);
    });
  }, [records, selectedFinca, selectedPluviometro, selectedAnio, selectedMes, etcEfectiva, capacidadSuelo]);

  // Calcular racha de días secos consecutivos para cada finca (HLG, HSL, TUC)
  const dryDaysData = useMemo(() => {
    if (records.length === 0) {
      return { '01': 0, '02': 0, '03': 0 };
    }

    const parseDateStr = (dStr) => {
      const parts = dStr.split('/');
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    };

    const normalizeDateStr = (dStr) => {
      const parts = dStr.split('/');
      return `${parseInt(parts[0], 10)}/${parseInt(parts[1], 10)}/${parts[2]}`;
    };

    const dates = records.map(r => parseDateStr(r.data));
    if (dates.length === 0) return { '01': 0, '02': 0, '03': 0 };
    
    const maxDate = new Date(Math.max(...dates));
    const minDate = new Date(Math.min(...dates));

    const result = {};
    const fincas = ['01', '02', '03'];

    fincas.forEach(fincaId => {
      const fincaRecords = records.filter(r => r.finca === fincaId);
      if (fincaRecords.length === 0) {
        result[fincaId] = 0;
        return;
      }

      // Obtener pluviómetros de esta finca
      const pluvs = [...new Set(fincaRecords.map(r => r.pluviometro))];
      const pluvCount = pluvs.length || 1;

      // Agrupar lluvias por fecha normalizada
      const precByDate = {};
      fincaRecords.forEach(r => {
        const normDate = normalizeDateStr(r.data);
        precByDate[normDate] = (precByDate[normDate] || 0) + r.prec;
      });

      let streak = 0;
      let currentDate = new Date(maxDate);

      while (currentDate >= minDate) {
        const normDate = `${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`;
        const dailyPrec = (precByDate[normDate] || 0) / pluvCount;

        if (dailyPrec < umbralLluvia) {
          streak++;
        } else {
          break;
        }

        currentDate.setDate(currentDate.getDate() - 1);
        
        // Evitar bucles infinitos
        if (streak > 365) break;
      }

      result[fincaId] = streak;
    });

    return result;
  }, [records, umbralLluvia]);

  // Calcular precipitación máxima en el último mes y en el año por finca (coincidiendo con la matriz)
  const maxPrecipitationData = useMemo(() => {
    const fincas = ['01', '02', '03'];
    const fincaMaxLastMonth = { '01': 0, '02': 0, '03': 0 };
    const fincaMaxAnnual = { '01': 0, '02': 0, '03': 0 };

    if (records.length === 0) {
      return { 
        lastMonthName: '', 
        yearLabel: '', 
        fincaMaxLastMonth,
        fincaMaxAnnual 
      };
    }

    const parseDateStr = (dStr) => {
      const parts = dStr.split('/');
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    };

    // 1. Obtener la cantidad de pluviómetros por finca en toda la base (exactamente como en la matriz)
    const pluvsByFinca = {};
    records.forEach(r => {
      if (!pluvsByFinca[r.finca]) pluvsByFinca[r.finca] = new Set();
      pluvsByFinca[r.finca].add(r.pluviometro);
    });
    const pluvCountByFinca = {};
    Object.keys(pluvsByFinca).forEach(f => {
      pluvCountByFinca[f] = pluvsByFinca[f].size;
    });

    // Nombres de meses en español
    const MESES_NOMBRES = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];

    const allDates = records.map(r => parseDateStr(r.data));
    const globalMaxDate = new Date(Math.max(...allDates));
    const globalLatestYear = globalMaxDate.getFullYear();
    const targetYear = selectedAnio !== 'Todos' ? parseInt(selectedAnio, 10) : globalLatestYear;

    let latestMonthNameStr = '';

    fincas.forEach(fincaId => {
      let fincaRecords = records.filter(r => r.finca === fincaId);
      // Solo aplicar el filtro de pluviómetro si es la finca seleccionada actualmente
      if (selectedPluviometro !== 'Todos' && fincaId === selectedFinca) {
        fincaRecords = fincaRecords.filter(r => r.pluviometro === selectedPluviometro);
      }

      if (fincaRecords.length === 0) {
        return;
      }

      const count = pluvCountByFinca[fincaId] || 1;

      // 1. Determinar el último mes y año con datos para esta finca
      const fincaDates = fincaRecords.map(r => parseDateStr(r.data));
      const fincaMaxDate = new Date(Math.max(...fincaDates));
      const lmYear = fincaMaxDate.getFullYear();
      const lmMonth = fincaMaxDate.getMonth() + 1;

      if (!latestMonthNameStr && fincaId === (selectedFinca === 'Todas' ? '01' : selectedFinca)) {
        latestMonthNameStr = `${MESES_NOMBRES[lmMonth - 1]} ${lmYear}`;
      }

      // Precipitación máxima (24h) en el último mes de esta finca, usando la lógica de la matriz
      const fincaLastMonthRecords = fincaRecords.filter(r => r.anio === lmYear && r.mes === lmMonth);
      const precByDateLM = {};
      fincaLastMonthRecords.forEach(r => {
        precByDateLM[r.data] = (precByDateLM[r.data] || 0) + r.prec;
      });
      const dailyAveragesLM = Object.keys(precByDateLM).map(d => precByDateLM[d] / count);
      fincaMaxLastMonth[fincaId] = dailyAveragesLM.length > 0 ? Math.max(...dailyAveragesLM) : 0;

      // 2. Precipitación máxima (24h) en el año seleccionado para esta finca, usando la lógica de la matriz
      const fincaYearRecords = fincaRecords.filter(r => r.anio === targetYear);
      const precByDateY = {};
      fincaYearRecords.forEach(r => {
        precByDateY[r.data] = (precByDateY[r.data] || 0) + r.prec;
      });
      const dailyAveragesY = Object.keys(precByDateY).map(d => precByDateY[d] / count);
      fincaMaxAnnual[fincaId] = dailyAveragesY.length > 0 ? Math.max(...dailyAveragesY) : 0;
    });

    if (!latestMonthNameStr) {
      const globalLatestMonth = globalMaxDate.getMonth() + 1;
      latestMonthNameStr = `${MESES_NOMBRES[globalLatestMonth - 1]} ${globalLatestYear}`;
    }

    return {
      lastMonthName: latestMonthNameStr,
      yearLabel: `${targetYear}`,
      fincaMaxLastMonth,
      fincaMaxAnnual
    };
  }, [records, selectedFinca, selectedPluviometro, selectedAnio]);

  // Estadísticas clave
  const stats = useMemo(() => {
    if (processedData.length === 0) return { totalPrec: 0, avgPrec: 0, rainDays: 0, totalDeficit: 0 };
    
    const totalPrec = processedData.reduce((acc, curr) => acc + curr.prec, 0);
    const avgPrec = totalPrec / processedData.length;
    const rainDays = processedData.filter(r => r.prec > 0).length;
    const totalDeficit = processedData.reduce((acc, curr) => acc + curr.deficit, 0);

    return {
      totalPrec: totalPrec.toFixed(1),
      avgPrec: avgPrec.toFixed(1),
      rainDays,
      totalDeficit: totalDeficit.toFixed(1)
    };
  }, [processedData]);

  // Estadísticas de eventos de lluvia (segundo recuadro)
  const rainEventsData = useMemo(() => {
    // 1. Obtener la cantidad real/total de pluviómetros por finca de toda la base
    const pluvsByFinca = {};
    records.forEach(r => {
      if (!pluvsByFinca[r.finca]) pluvsByFinca[r.finca] = new Set();
      pluvsByFinca[r.finca].add(r.pluviometro);
    });
    const pluvCountByFinca = {};
    Object.keys(pluvsByFinca).forEach(f => {
      pluvCountByFinca[f] = pluvsByFinca[f].size;
    });

    // 2. Filtrar registros por año, finca, pluviómetro y mes
    let filtered = records;
    if (selectedAnio !== 'Todos') {
      filtered = filtered.filter(r => String(r.anio) === selectedAnio);
    }
    if (selectedFinca !== 'Todas') {
      filtered = filtered.filter(r => r.finca === selectedFinca);
    }
    if (selectedPluviometro !== 'Todos') {
      filtered = filtered.filter(r => r.pluviometro === selectedPluviometro);
    }
    if (selectedMes !== 'Todos') {
      filtered = filtered.filter(r => String(r.mes) === selectedMes);
    }

    // 3. Agrupar por fecha (dia/mes/anio) y finca, sumando la precipitación
    const dailyData = {};
    filtered.forEach(r => {
      const dateKey = `${r.dia}/${r.mes}/${r.anio}`;
      const groupKey = `${r.finca}_${dateKey}`;
      
      if (!dailyData[groupKey]) {
        dailyData[groupKey] = {
          finca: r.finca,
          dateStr: dateKey,
          precSum: 0,
          dia: r.dia,
          mes: r.mes,
          anio: r.anio
        };
      }
      dailyData[groupKey].precSum += r.prec;
    });

    // 4. Calcular el promedio diario de cada grupo
    const eventsList = [];
    Object.values(dailyData).forEach(item => {
      let avgPrec = 0;
      if (selectedPluviometro !== 'Todos') {
        avgPrec = item.precSum;
      } else {
        const count = pluvCountByFinca[item.finca] || 1;
        avgPrec = item.precSum / count;
      }

      if (avgPrec > 0) {
        eventsList.push({
          dateStr: item.dateStr,
          prec: avgPrec,
          finca: item.finca,
          dia: item.dia,
          mes: item.mes,
          anio: item.anio
        });
      }
    });

    // 5. Ordenar por fecha descendente
    eventsList.sort((a, b) => {
      if (a.anio !== b.anio) return b.anio - a.anio;
      if (a.mes !== b.mes) return b.mes - a.mes;
      return b.dia - a.dia;
    });

    const eventCount = eventsList.length;

    let lastRainText = 'Sin lluvias en este periodo';
    if (eventsList.length > 0) {
      const last = eventsList[0];
      const fincaName = FINCA_NAMES[last.finca] || `Finca ${last.finca}`;
      if (selectedFinca === 'Todas') {
        lastRainText = `Última: ${last.dateStr} en ${fincaName} (${last.prec.toFixed(1)} mm)`;
      } else {
        lastRainText = `Última: ${last.dateStr} (${last.prec.toFixed(1)} mm)`;
      }
    }

    return {
      eventCount,
      lastRainText
    };
  }, [records, selectedAnio, selectedFinca, selectedPluviometro, selectedMes]);

  // Calcular la precipitación acumulada promedio por finca para mostrar siempre en la primera tarjeta
  const fincaAccumulatedPrec = useMemo(() => {
    // 1. Obtener la cantidad real/total de pluviómetros por finca de toda la base
    const pluvsByFinca = {};
    records.forEach(r => {
      if (!pluvsByFinca[r.finca]) pluvsByFinca[r.finca] = new Set();
      pluvsByFinca[r.finca].add(r.pluviometro);
    });
    const pluvCountByFinca = {};
    Object.keys(pluvsByFinca).forEach(f => {
      pluvCountByFinca[f] = pluvsByFinca[f].size;
    });

    // 2. Filtrar registros por año y mes
    let filtered = records;
    if (selectedAnio !== 'Todos') {
      filtered = filtered.filter(r => String(r.anio) === selectedAnio);
    }
    if (selectedMes !== 'Todos') {
      filtered = filtered.filter(r => String(r.mes) === selectedMes);
    }

    // 3. Agrupar precipitación por finca y fecha
    const dailyFincaPrec = {};
    filtered.forEach(r => {
      const key = `${r.finca}_${r.data}`;
      dailyFincaPrec[key] = (dailyFincaPrec[key] || 0) + r.prec;
    });

    // 4. Sumar los promedios diarios por finca
    const result = {};
    Object.keys(FINCA_NAMES).forEach(fKey => {
      result[fKey] = 0;
    });

    Object.keys(dailyFincaPrec).forEach(key => {
      const [finca] = key.split('_');
      const sumPrec = dailyFincaPrec[key];
      const numPluvs = pluvCountByFinca[finca] || 1;
      const dailyAvg = sumPrec / numPluvs;
      
      if (result[finca] !== undefined) {
        result[finca] += dailyAvg;
      }
    });

    return result;
  }, [records, selectedAnio, selectedMes]);

  // Generar datos para la matriz mensual de precipitación (según el filtro de finca, pluviómetro y año activo)
  const matrixData = useMemo(() => {
    // Inicializar matriz de 12 meses x 31 días con 0
    const matrix = Array.from({ length: 12 }, () => Array.from({ length: 31 }, () => 0));

    // 1. Obtener la cantidad real/total de pluviómetros por finca de toda la base
    const pluvsByFinca = {};
    records.forEach(r => {
      if (!pluvsByFinca[r.finca]) pluvsByFinca[r.finca] = new Set();
      pluvsByFinca[r.finca].add(r.pluviometro);
    });
    const pluvCountByFinca = {};
    Object.keys(pluvsByFinca).forEach(f => {
      pluvCountByFinca[f] = pluvsByFinca[f].size;
    });

    // 2. Obtener el año activo
    const activeYear = selectedAnio !== 'Todos' ? parseInt(selectedAnio, 10) : (uniqueAnios[0] || new Date().getFullYear());

    // 3. Filtrar registros por ese año (base global para determinar la última fecha de datos ingresados)
    const globalYearRecords = records.filter(r => r.anio === activeYear);

    // 3.5 Encontrar la última fecha con datos ingresada en este año de forma GLOBAL (todas las fincas)
    let latestMonth = -1;
    let latestDay = -1;
    globalYearRecords.forEach(r => {
      if (r.mes > latestMonth) {
        latestMonth = r.mes;
        latestDay = r.dia;
      } else if (r.mes === latestMonth) {
        if (r.dia > latestDay) {
          latestDay = r.dia;
        }
      }
    });

    let yearRecords = [...globalYearRecords];

    // Filtrar por finca seleccionada si no es 'Todas'
    if (selectedFinca && selectedFinca !== 'Todas') {
      yearRecords = yearRecords.filter(r => r.finca === selectedFinca);
    }

    // Filtrar por pluviómetro si es un filtro específico
    const isSpecificPluv = selectedPluviometro && selectedPluviometro !== 'Todos';
    if (isSpecificPluv) {
      yearRecords = yearRecords.filter(r => r.pluviometro === selectedPluviometro);
    }

    // 4. Agrupar por finca, pluviometro, mes y día
    const grouped = {};
    yearRecords.forEach(r => {
      const key = `${r.finca}_${r.pluviometro}_${r.mes}_${r.dia}`;
      grouped[key] = (grouped[key] || 0) + r.prec;
    });

    // 5. Rellenar la matriz según la finca y pluviómetro seleccionado
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        if (isSpecificPluv) {
          // Si hay un pluviómetro específico, traemos los datos directos sin ponderar/dividir
          if (selectedFinca !== 'Todas') {
            const key = `${selectedFinca}_${selectedPluviometro}_${m}_${d}`;
            matrix[m - 1][d - 1] = grouped[key] || 0;
          } else {
            // Si es Todas las fincas pero un pluviómetro específico
            let daySum = 0;
            Object.keys(FINCA_NAMES).forEach(fKey => {
              const key = `${fKey}_${selectedPluviometro}_${m}_${d}`;
              daySum += grouped[key] || 0;
            });
            matrix[m - 1][d - 1] = daySum;
          }
        } else {
          // Si están seleccionados todos los pluviómetros ("Todos")
          if (selectedFinca !== 'Todas') {
            // Promedio de los pluviómetros de la finca seleccionada
            let daySum = 0;
            const pluvs = pluvsByFinca[selectedFinca] ? Array.from(pluvsByFinca[selectedFinca]) : [];
            pluvs.forEach(p => {
              const key = `${selectedFinca}_${p}_${m}_${d}`;
              daySum += grouped[key] || 0;
            });
            const count = pluvCountByFinca[selectedFinca] || 1;
            matrix[m - 1][d - 1] = daySum / count;
          } else {
            // Promedio ponderado para todas las fincas
            let daySum = 0;
            Object.keys(FINCA_NAMES).forEach(fKey => {
              let fincaSum = 0;
              const pluvs = pluvsByFinca[fKey] ? Array.from(pluvsByFinca[fKey]) : [];
              pluvs.forEach(p => {
                const key = `${fKey}_${p}_${m}_${d}`;
                fincaSum += grouped[key] || 0;
              });
              const count = pluvCountByFinca[fKey] || 1;
              daySum += fincaSum / count;
            });
            matrix[m - 1][d - 1] = daySum;
          }
        }
      }
    }

    // (Última fecha calculada síncronamente a nivel global al inicio de este useMemo)

    // 6. Calcular totales por mes y cantidad de eventos
    const rowTotals = [];
    const rowEvents = [];
    let totalYearPrec = 0;
    let totalYearEvents = 0;

    for (let m = 0; m < 12; m++) {
      let monthSum = 0;
      let monthEvents = 0;
      for (let d = 0; d < 31; d++) {
        const val = matrix[m][d];
        monthSum += val;
        if (val > 0) {
          monthEvents += 1;
        }
      }
      rowTotals.push(monthSum);
      rowEvents.push(monthEvents);
      totalYearPrec += monthSum;
      totalYearEvents += monthEvents;
    }

    return {
      matrix,
      rowTotals,
      rowEvents,
      totalYearPrec,
      totalYearEvents,
      activeYear,
      latestMonth,
      latestDay
    };
  }, [records, selectedAnio, selectedFinca, selectedPluviometro, uniqueAnios]);

  const chartData = useMemo(() => {
    const isSpecificPluv = selectedPluviometro && selectedPluviometro !== 'Todos';
    const cropNeed = 30 * etcEfectiva;
    return {
      labels: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
      datasets: [
        {
          type: 'bar',
          label: isSpecificPluv ? 'Precipitación Registrada (mm)' : 'Precipitación Promedio Ponderada (mm)',
          data: matrixData.rowTotals,
          backgroundColor: 'rgba(0, 242, 254, 0.7)',
          borderColor: '#00f2fe',
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: 'y',
          order: 3, // Draw behind
        },
        {
          type: 'line',
          label: 'Necesidad del Cultivo (mm)',
          data: Array(12).fill(cropNeed),
          borderColor: '#ffd600',
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [5, 5],
          fill: false,
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line',
          label: 'Eventos de Lluvia',
          data: matrixData.rowEvents,
          borderColor: '#ff4b4b',
          borderWidth: 3,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#ff4b4b',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          yAxisID: 'y1',
          order: 1, // Draw on top
        }
      ]
    };
  }, [matrixData, selectedPluviometro, etcEfectiva]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 15
        }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: 'rgba(255, 255, 255, 0.8)',
            font: {
              family: 'Outfit, sans-serif',
              size: 12,
              weight: '500'
            },
            padding: 20
          }
        },
        tooltip: {
          backgroundColor: 'rgba(10, 15, 30, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          cornerRadius: 8,
          titleFont: {
            family: 'Outfit, sans-serif',
            weight: 'bold',
            size: 13
          },
          bodyFont: {
            family: 'Inter, sans-serif',
            size: 12
          }
        },
        horizontalLine: {
          yValue: 30 * etcEfectiva,
          borderColor: '#ffd600',
          borderWidth: 2.5
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.6)',
            font: {
              family: 'Inter, sans-serif',
              size: 11
            }
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grace: '10%',
          title: {
            display: true,
            text: 'Precipitación (mm)',
            color: 'rgba(0, 242, 254, 0.9)',
            font: {
              family: 'Outfit, sans-serif',
              size: 12,
              weight: '600'
            }
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.6)',
            font: {
              family: 'Inter, sans-serif'
            }
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grace: '10%',
          title: {
            display: true,
            text: 'Eventos de Lluvia',
            color: '#ff4b4b',
            font: {
              family: 'Outfit, sans-serif',
              size: 12,
              weight: '600'
            }
          },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.6)',
            font: {
              family: 'Inter, sans-serif'
            }
          }
        }
      }
    };
  }, [etcEfectiva]);

  return (
    <div className="app-container">
      {/* Main Content */}
      <main className="main-content">
        
        {/* Header */}
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            {/* Logo Container */}
            <div className="sidebar-logo" 
              onClick={handleLogoClick}
              title="Click para activar la animación de la gota"
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.75rem', 
                padding: 0,
                margin: 0,
                borderBottom: 'none',
                cursor: 'pointer'
              }}
            >
              <svg 
                viewBox="0 0 24 24" 
                width={26} 
                height={26} 
                fill="#00f2fe" 
                stroke="#00f2fe" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                style={{ 
                  flexShrink: 0,
                  filter: 'drop-shadow(0 0 10px rgba(0, 242, 254, 0.85))',
                  display: 'inline-block',
                  overflow: 'visible'
                }}
              >
                {/* Gotas de la explosión (salpicadura) */}
                <circle className="logo-splash-p" cx={12} cy={22} r={1.2} style={{ opacity: 0, fill: '#00f2fe', stroke: 'none', transformOrigin: '12px 22px' }} />
                <circle className="logo-splash-p" cx={12} cy={22} r={1.2} style={{ opacity: 0, fill: '#00f2fe', stroke: 'none', transformOrigin: '12px 22px' }} />
                <circle className="logo-splash-p" cx={12} cy={22} r={1.2} style={{ opacity: 0, fill: '#00f2fe', stroke: 'none', transformOrigin: '12px 22px' }} />
                <circle className="logo-splash-p" cx={12} cy={22} r={1.2} style={{ opacity: 0, fill: '#00f2fe', stroke: 'none', transformOrigin: '12px 22px' }} />
                <circle className="logo-splash-p" cx={12} cy={22} r={1.2} style={{ opacity: 0, fill: '#00f2fe', stroke: 'none', transformOrigin: '12px 22px' }} />

                {/* Gota principal */}
                <path 
                  className="logo-droplet" 
                  d="M12 22a7 7 0 0 0 7-7c0-4.3-7-13-7-13S5 10.7 5 15a7 7 0 0 0 7 7z" 
                  style={{ transformOrigin: '12px 22px' }}
                />

                {/* Palma de aceite (nace del impacto en un grupo para soportar scaleX/scaleY) */}
                <g
                  className="logo-palm"
                  style={{ opacity: 0, transformOrigin: '12px 22px' }}
                >
                  {/* Tronco de la palma (café) */}
                  <path
                    d="M12 22q.5-6 0-10"
                    style={{ fill: 'none', stroke: '#8B5A2B', strokeWidth: '2.2px' }}
                  />
                  {/* Hojas de la palma (verde) */}
                  <path
                    d="M12 12q-4-2-7 2 M12 12q4-2 7 2 M12 12q-4-5-5-1 M12 12q4-5 5-1 M12 12q-1-7-1-3 M12 12q1-7 1-3"
                    style={{ fill: 'none', stroke: '#00c853', strokeWidth: '1.6px' }}
                  />
                </g>
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ 
                  fontFamily: 'var(--font-display)', 
                  fontSize: '1.15rem', 
                  fontWeight: 700, 
                  letterSpacing: '-0.5px',
                  background: 'linear-gradient(135deg, var(--text-main) 30%, var(--accent) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  lineHeight: '1.2'
                }}>GAHLG Balance</span>
                <span style={{ 
                  fontSize: '0.6rem', 
                  color: 'var(--accent)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '2.5px', 
                  fontWeight: 600,
                  marginTop: '1px'
                }}>hidrico</span>
                      </div>
            </div>

            {/* Vertical divider */}
            <div style={{ height: '35px', width: '1px', background: 'var(--border-light)' }}></div>

            {/* Header Title */}
            <div className="header-title">
              <h2 style={{ margin: 0 }}>Dashboard</h2>
              <p style={{ margin: '2px 0 0 0' }}>El agua es el motor de la vida y productividad de todo cultivo.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span className="glass-panel" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Server size={14} className="text-success" />
              Nube Firebase: Activa
            </span>
            <span className="glass-panel" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Database size={14} className={records.length > 0 ? "text-success" : "text-danger"} />
              Total: {records.length > 0 ? `${records.length.toLocaleString('es-ES')} registros` : 'Vacía'}
            </span>
            <button 
              className="settings-btn" 
              onClick={handleOpenSettings}
              title="Configuración y Carga de Lluvias"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Contenedor de Pestañas y Contenido para eliminar el espacio vacío y permitir fusión tipo carpeta */}
        <div className="tab-container" style={{ display: 'flex', flexDirection: 'column' }}>
          
          {errorMessage && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              padding: '1rem',
              borderRadius: '8px',
              margin: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem'
            }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
                Error de Conexión o Lectura en Firebase
              </strong>
              <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.85 }}>{errorMessage}</p>
            </div>
          )}
          
          {/* Pestañas de navegación */}
          <nav className="tab-navigation">
            <button 
              className={`tab-btn ${activeTab === 'pluviometrico' ? 'active' : ''}`}
              onClick={() => setActiveTab('pluviometrico')}
            >
              <CloudRain size={15} />
              Monitoreo Pluviómetro
            </button>
            <button 
              className={`tab-btn ${activeTab === 'balance' ? 'active' : ''}`}
              onClick={() => setActiveTab('balance')}
            >
              <Layers size={15} />
              Balance
            </button>
            <button 
              className={`tab-btn ${activeTab === 'mapas' ? 'active' : ''}`}
              onClick={() => setActiveTab('mapas')}
            >
              <MapPin size={15} />
              Mapas
            </button>
          </nav>

          {/* CONTENIDO DE LAS PESTAÑAS */}
          {activeTab === 'pluviometrico' ? (
            <div key="pluviometrico" className="tab-content tab-content-active" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {loading && loadingSource && !syncStatus ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', flexDirection: 'column', gap: '1rem' }}>
            <RefreshCw className="text-accent animate-spin" size={36} />
            <p style={{ fontWeight: 500 }}>{loadingSource}</p>
          </div>
        ) : records.length === 0 ? (
          <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <CloudRain size={64} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <h3>No hay datos cargados en Firebase aún</h3>
            <p style={{ color: 'var(--text-muted)', maxWidth: '500px' }}>
              Para comenzar a visualizar el balance hídrico, abre el panel de configuración desde el botón <Settings size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> en la esquina superior derecha y sube tu archivo Excel.
            </p>
            <button className="btn" onClick={handleOpenSettings}>
              <Upload size={18} />
              Abrir Configuración y Carga
            </button>
          </div>
        ) : (
          <>
            {/* Panel de Filtros */}
            <section className="glass-panel filters-panel" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', flexGrow: 1 }}>
                <div className="filter-group" style={{ minWidth: '180px' }}>
                  <label htmlFor="finca-select"><MapPin size={12} style={{ marginRight: '4px' }} /> Finca</label>
                  <select 
                    id="finca-select"
                    className="select-control"
                    value={selectedFinca}
                    onChange={(e) => {
                      const newFinca = e.target.value;
                      setSelectedFinca(newFinca);
                      
                      // Resolver pluviómetro de forma síncrona para evitar estados vacíos temporales
                      let newPluv = 'Todos';
                      if (newFinca !== 'Todas') {
                        const pluvs = [...new Set(records.filter(r => r.finca === newFinca).map(r => r.pluviometro))].sort();
                        if (pluvs.length === 1) {
                          newPluv = pluvs[0];
                        }
                      }
                      setSelectedPluviometro(newPluv);
                      
                      // Resolver año de forma síncrona
                      let filteredForYears = records;
                      if (newFinca !== 'Todas') {
                        filteredForYears = filteredForYears.filter(r => r.finca === newFinca);
                      }
                      if (newPluv !== 'Todos') {
                        filteredForYears = filteredForYears.filter(r => r.pluviometro === newPluv);
                      }
                      const availableYears = [...new Set(filteredForYears.map(r => r.anio))].sort((a, b) => b - a);
                      
                      if (availableYears.length > 0 && selectedAnio !== 'Todos') {
                        const currentAnioNum = parseInt(selectedAnio, 10);
                        if (!availableYears.includes(currentAnioNum)) {
                          setSelectedAnio(String(availableYears[0]));
                        }
                      }
                    }}
                  >
                    <option value="Todas">Todas</option>
                    {uniqueFincas.map(f => (
                      <option key={f} value={f}>
                        {FINCA_NAMES[f] || `Finca ${f}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="filter-group" style={{ minWidth: '180px' }}>
                  <label htmlFor="pluv-select"><Layers size={12} style={{ marginRight: '4px' }} /> Pluviómetro</label>
                  <select 
                    id="pluv-select"
                    className="select-control"
                    value={selectedPluviometro}
                    onChange={(e) => {
                      const newPluv = e.target.value;
                      setSelectedPluviometro(newPluv);
                      
                      // Resolver año de forma síncrona
                      let filteredForYears = records;
                      if (selectedFinca !== 'Todas') {
                        filteredForYears = filteredForYears.filter(r => r.finca === selectedFinca);
                      }
                      if (newPluv !== 'Todos') {
                        filteredForYears = filteredForYears.filter(r => r.pluviometro === newPluv);
                      }
                      const availableYears = [...new Set(filteredForYears.map(r => r.anio))].sort((a, b) => b - a);
                      
                      if (availableYears.length > 0 && selectedAnio !== 'Todos') {
                        const currentAnioNum = parseInt(selectedAnio, 10);
                        if (!availableYears.includes(currentAnioNum)) {
                          setSelectedAnio(String(availableYears[0]));
                        }
                      }
                    }}
                    disabled={uniquePluviometros.length === 0}
                  >
                    {(selectedFinca === 'Todas' || uniquePluviometros.length > 1) && (
                      <option value="Todos">Todos</option>
                    )}
                    {uniquePluviometros.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div className="filter-group" style={{ minWidth: '120px' }}>
                  <label htmlFor="anio-select"><Calendar size={12} style={{ marginRight: '4px' }} /> Año</label>
                  <select 
                    id="anio-select"
                    className="select-control"
                    value={selectedAnio}
                    onChange={(e) => setSelectedAnio(e.target.value)}
                    disabled={uniqueAnios.length === 0}
                  >
                    <option value="Todos">Todos</option>
                    {uniqueAnios.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>

                <div className="filter-group" style={{ minWidth: '150px' }}>
                  <label htmlFor="mes-select"><Calendar size={12} style={{ marginRight: '4px' }} /> Mes</label>
                  <select 
                    id="mes-select"
                    className="select-control"
                    value={selectedMes}
                    onChange={(e) => setSelectedMes(e.target.value)}
                    disabled={uniqueMeses.length === 0}
                  >
                    <option value="Todos">Todos</option>
                    {uniqueMeses.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div ref={compareDropdownRef} className="filter-group" style={{ minWidth: '160px', position: 'relative' }}>
                  <label><Calendar size={12} style={{ marginRight: '4px' }} /> Comparar Años</label>
                  <div 
                    className="select-control"
                    onClick={() => setCompareDropdownOpen(!compareDropdownOpen)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      position: 'relative',
                      minHeight: '41px',
                      padding: '0.45rem 1rem'
                    }}
                  >
                    <span style={{ 
                      textOverflow: 'ellipsis', 
                      overflow: 'hidden', 
                      whiteSpace: 'nowrap',
                      maxWidth: '120px',
                      fontSize: '0.9rem' 
                    }}>
                      {selectedCompareAnios.length === 0 
                        ? 'Ninguno' 
                        : selectedCompareAnios.join(', ')}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>▼</span>
                  </div>
                  
                  {compareDropdownOpen && (
                    <>
                      <div 
                        className="glass-panel" 
                        style={{
                          position: 'absolute',
                          top: '105%',
                          left: 0,
                          width: '100%',
                          zIndex: 1001,
                          background: 'var(--bg-app)',
                          boxShadow: 'var(--glass-shadow)',
                          border: '1px solid var(--border-light)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.5rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.4rem',
                          maxHeight: '200px',
                          overflowY: 'auto'
                        }}
                      >
                        {uniqueAnios.map(a => {
                          const isChecked = selectedCompareAnios.includes(a);
                          return (
                            <label 
                              key={a} 
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                background: isChecked ? 'rgba(0, 242, 254, 0.05)' : 'transparent',
                                transition: 'background 0.2s',
                                margin: 0,
                                color: 'var(--text-main)'
                              }}
                            >
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedCompareAnios(selectedCompareAnios.filter(yr => yr !== a));
                                  } else {
                                    setSelectedCompareAnios([...selectedCompareAnios, a].sort((x, y) => x - y));
                                  }
                                }}
                                style={{ 
                                  accentColor: 'var(--accent)',
                                  cursor: 'pointer'
                                }}
                              />
                              {a}
                            </label>
                          );
                        })}
                        {uniqueAnios.length === 0 && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem 0' }}>
                            Sin años disponibles
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>


              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'stretch', flexWrap: 'wrap' }}>
                {/* Tarjeta 1: Parámetros — diseño compacto en grid */}
                <div className="glass-panel" style={{ 
                  padding: '0.5rem 0.75rem', 
                  background: 'rgba(255, 255, 255, 0.02)', 
                  borderStyle: 'dashed',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.2rem',
                  flex: '1 1 auto'
                }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Config. Balance</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 12px', fontSize: '0.72rem', fontWeight: 600 }}>
                    <span title="Evapotranspiración Diaria de Diseño">ET₀: <span className="text-accent">{etReferencial} mm/d</span></span>
                    <span title="Coeficiente de Cultivo">Kc: <span className="text-accent">{kcCultivo}</span></span>
                    <span title="Evapotranspiración Real del Cultivo">ETc: <span className="text-accent">{etcEfectiva.toFixed(2)} mm/d</span></span>
                    <span title="Capacidad de Agua Disponible del Suelo">Suelo: <span className="text-accent">{capacidadSuelo} mm</span></span>
                    <span title="Umbral de lluvia para considerar un día como seco" style={{ gridColumn: '1 / -1' }}>Umbral seco: <span className="text-warning">{umbralLluvia} mm</span></span>
                  </div>
                </div>

                {/* Tarjeta 2: Botón */}
                <div className="glass-panel" style={{ 
                  padding: '0.5rem 0.75rem', 
                  background: 'rgba(255, 255, 255, 0.02)', 
                  borderStyle: 'dashed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 auto'
                }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={handleOpenHistoryModal}
                    style={{ 
                      padding: '0.4rem 0.8rem', 
                      fontSize: '0.75rem', 
                      whiteSpace: 'nowrap',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <Calendar size={13} />
                    Datos históricos
                  </button>
                </div>
              </div>

            </section>

            {processedData.length === 0 ? (
              <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
                <Info size={32} style={{ color: 'var(--warning)', marginBottom: '1rem' }} />
                <p>No se encontraron datos para la combinación seleccionada de Finca, Pluviómetro y Año.</p>
              </div>
            ) : (
              <>
                {/* Tarjetas de Métricas */}
                <section className="metrics-grid">
                  <div className="glass-panel metric-card glass-panel-hover">
                    <div className="metric-header">
                      <span>Precipitación Acumulada</span>
                      <CloudRain size={20} className="text-accent" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', width: '100%' }}>
                      {Object.keys(FINCA_NAMES).map(fKey => {
                        const isSelected = selectedFinca === fKey;
                        const isAll = selectedFinca === 'Todas';
                        const val = fincaAccumulatedPrec?.[fKey] !== undefined ? `${fincaAccumulatedPrec[fKey].toFixed(1)} mm` : '0.0 mm';
                        
                        if (isAll) {
                          return (
                            <div key={fKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem', padding: '0.1rem 0' }}>
                              <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{FINCA_NAMES[fKey]}:</span>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
                                {val}
                              </span>
                            </div>
                          );
                        } else if (isSelected) {
                          return (
                            <div key={fKey} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: '1.25rem', 
                              fontWeight: 700, 
                              color: 'var(--accent)', 
                              background: 'linear-gradient(90deg, var(--accent-glow), transparent)',
                              padding: '0.35rem 0.6rem', 
                              borderRadius: 'var(--radius-sm)',
                              borderLeft: '3px solid var(--accent)',
                              boxShadow: '0 0 10px 0 var(--accent-glow)'
                            }}>
                              <span>{FINCA_NAMES[fKey]}</span>
                              <span style={{ fontFamily: 'var(--font-display)' }}>{val}</span>
                            </div>
                          );
                        } else {
                          return (
                            <div key={fKey} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: '0.85rem', 
                              color: 'var(--text-muted)', 
                              opacity: 0.4,
                              padding: '0.05rem 0.6rem' 
                            }}>
                              <span>{FINCA_NAMES[fKey]}:</span>
                              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>{val}</span>
                            </div>
                          );
                        }
                      })}
                    </div>
                  </div>

                  <div className="glass-panel metric-card glass-panel-hover">
                    <div className="metric-header">
                      <span>Eventos de Lluvia</span>
                      <Droplet size={20} className="text-accent" />
                    </div>
                    <div className="metric-value">
                      {rainEventsData.eventCount}{' '}
                      <span style={{ fontSize: '1rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                        {rainEventsData.eventCount === 1 ? 'evento' : 'eventos'}
                      </span>
                    </div>
                    <div className="metric-trend" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }} title={rainEventsData.lastRainText}>
                      {rainEventsData.lastRainText}
                    </div>
                  </div>

                  <div className="glass-panel metric-card glass-panel-hover">
                    <div className="metric-header">
                      <span>Días Secos Consecutivos</span>
                      <Sun size={20} className="text-warning" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', width: '100%' }}>
                      {Object.keys(FINCA_NAMES).map(fKey => {
                        const isSelected = selectedFinca === fKey;
                        const isAll = selectedFinca === 'Todas';
                        const val = dryDaysData[fKey] !== undefined ? `${dryDaysData[fKey]} ${dryDaysData[fKey] === 1 ? 'día' : 'días'}` : '0 días';
                        
                        if (isAll) {
                          return (
                            <div key={fKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem', padding: '0.1rem 0' }}>
                              <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{FINCA_NAMES[fKey]}:</span>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
                                {val}
                              </span>
                            </div>
                          );
                        } else if (isSelected) {
                          return (
                            <div key={fKey} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: '1.25rem', 
                              fontWeight: 700, 
                              color: 'var(--warning)', 
                              background: 'linear-gradient(90deg, var(--warning-glow), transparent)',
                              padding: '0.35rem 0.6rem', 
                              borderRadius: 'var(--radius-sm)',
                              borderLeft: '3px solid var(--warning)',
                              boxShadow: '0 0 10px 0 var(--warning-glow)'
                            }}>
                              <span>{FINCA_NAMES[fKey]}</span>
                              <span style={{ fontFamily: 'var(--font-display)' }}>{val}</span>
                            </div>
                          );
                        } else {
                          return (
                            <div key={fKey} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: '0.85rem', 
                              color: 'var(--text-muted)', 
                              opacity: 0.4,
                              padding: '0.05rem 0.6rem' 
                            }}>
                              <span>{FINCA_NAMES[fKey]}:</span>
                              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>{val}</span>
                            </div>
                          );
                        }
                      })}
                    </div>
                  </div>

                  <div className="glass-panel metric-card glass-panel-hover" style={{ padding: '1rem' }}>
                    <div className="metric-header" style={{ marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Precipitación Máxima (24h)</span>
                      <TrendingUp size={16} className="text-accent" />
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', width: '100%' }}>
                      {/* Columna 1: Último Mes */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)', paddingBottom: '0.2rem', marginBottom: '0.1rem', whiteSpace: 'nowrap' }}>
                          Último Mes ({maxPrecipitationData.lastMonthName}):
                        </span>
                        {Object.keys(FINCA_NAMES).map(fKey => {
                          const isSelected = selectedFinca === fKey;
                          const val = maxPrecipitationData.fincaMaxLastMonth?.[fKey] !== undefined 
                            ? `${maxPrecipitationData.fincaMaxLastMonth[fKey].toFixed(1)}` 
                            : '0.0';
                          
                          return (
                            <div key={`lm-${fKey}`} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: isSelected ? '0.82rem' : '0.78rem', 
                              fontWeight: isSelected ? 700 : 500,
                              color: isSelected ? 'var(--accent)' : 'var(--text-main)',
                              opacity: isSelected ? 1 : 0.8,
                              background: isSelected ? 'linear-gradient(90deg, var(--accent-glow), transparent)' : 'transparent',
                              padding: isSelected ? '0.1rem 0.25rem' : '0.05rem 0',
                              borderRadius: 'var(--radius-sm)'
                            }}>
                              <span style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)' }}>{FINCA_NAMES[fKey]}:</span>
                              <span>{val} <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-muted)' }}>mm</span></span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Columna 2: Máxima Anual */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)', paddingBottom: '0.2rem', marginBottom: '0.1rem', whiteSpace: 'nowrap' }}>
                          Máxima Anual ({maxPrecipitationData.yearLabel}):
                        </span>
                        {Object.keys(FINCA_NAMES).map(fKey => {
                          const isSelected = selectedFinca === fKey;
                          const val = maxPrecipitationData.fincaMaxAnnual?.[fKey] !== undefined 
                            ? `${maxPrecipitationData.fincaMaxAnnual[fKey].toFixed(1)}` 
                            : '0.0';
                          
                          return (
                            <div key={`y-${fKey}`} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: isSelected ? '0.82rem' : '0.78rem', 
                              fontWeight: isSelected ? 700 : 500,
                              color: isSelected ? 'var(--accent)' : 'var(--text-main)',
                              opacity: isSelected ? 1 : 0.8,
                              background: isSelected ? 'linear-gradient(90deg, var(--accent-glow), transparent)' : 'transparent',
                              padding: isSelected ? '0.1rem 0.25rem' : '0.05rem 0',
                              borderRadius: 'var(--radius-sm)'
                            }}>
                              <span style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)' }}>{FINCA_NAMES[fKey]}:</span>
                              <span>{val} <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-muted)' }}>mm</span></span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Matriz Anual de Precipitación Promedio Ponderado */}
                <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', width: '100%' }}>
                    <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.1rem', margin: 0 }}>
                      {selectedPluviometro && selectedPluviometro !== 'Todos' ? (
                        `Precipitación Registrada (${matrixData.activeYear}) - Pluviómetro ${selectedPluviometro}`
                      ) : (
                        `Precipitación Promedio Ponderado (${matrixData.activeYear}) - ${selectedFinca === 'Todas' ? 'Todas las Fincas' : (FINCA_NAMES[selectedFinca] || `Finca ${selectedFinca}`)}`
                      )}
                    </h4>
                    <button
                      onClick={handleDownloadMatrixExcel}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: 0.5,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        transition: 'opacity 0.2s, background 0.2s',
                        outline: 'none'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.background = 'transparent'; }}
                      title="Descargar matriz en Excel"
                    >
                      <Download size={11} />
                      Descargar Excel
                    </button>
                  </div>
                  <div style={{ 
                    overflowX: 'auto', 
                    overflowY: 'hidden', 
                    width: '100%', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid var(--border-light)',
                    paddingBottom: '10px'
                  }}>
                    <table style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      textAlign: 'center',
                      fontSize: '0.72rem',
                      color: 'var(--text-main)',
                      fontFamily: 'var(--font-body)',
                      minWidth: '1000px'
                    }}>
                      <thead>
                        <tr style={{ background: 'rgba(255, 255, 255, 0.04)' }}>
                          <th style={{
                            padding: '0.25rem 0.4rem',
                            borderBottom: '2px solid var(--border-light)',
                            borderRight: '1px solid var(--border-light)',
                            color: 'var(--text-muted)',
                            fontWeight: '600',
                            textAlign: 'left',
                            width: '65px',
                            fontSize: '0.72rem'
                          }}>Mes</th>
                          {Array.from({ length: 31 }, (_, i) => (
                            <th key={i + 1} style={{
                              padding: '0.2,rem 0.1rem',
                              borderBottom: '2px solid var(--border-light)',
                              borderRight: '1px solid var(--border-light)',
                              color: 'var(--text-muted)',
                              fontWeight: '600',
                              width: '28px',
                              fontSize: '0.72rem'
                            }}>{i + 1}</th>
                          ))}
                          <th style={{
                            padding: '0.25rem 0.4rem',
                            borderBottom: '2px solid var(--border-light)',
                            borderRight: '1px solid var(--border-light)',
                            color: 'var(--text-muted)',
                            fontWeight: '600',
                            width: '55px',
                            fontSize: '0.72rem'
                          }}>Total Mes</th>
                          <th style={{
                            padding: '0.25rem 0.4rem',
                            borderBottom: '2px solid var(--border-light)',
                            color: 'var(--text-muted)',
                            fontWeight: '600',
                            width: '65px',
                            fontSize: '0.72rem'
                          }}>Num Eventos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"].map((monthName, mIdx) => {
                          const monthTotal = matrixData.rowTotals[mIdx];
                          const monthEvents = matrixData.rowEvents[mIdx];
                          return (
                            <tr key={monthName} style={{ borderBottom: '1px solid var(--border-light)' }}>
                              <td style={{
                                textAlign: 'left',
                                fontWeight: '600',
                                color: 'var(--text-main)',
                                background: 'rgba(255, 255, 255, 0.01)',
                                padding: '0.15rem 0.4rem',
                                borderRight: '1px solid var(--border-light)',
                                fontSize: '0.72rem'
                              }}>{monthName}</td>
                              {Array.from({ length: 31 }, (_, dIdx) => {
                                const val = matrixData.matrix[mIdx][dIdx];
                                const isRainy = val > 0;
                                const isLatestDate = mIdx === matrixData.latestMonth - 1 && dIdx === matrixData.latestDay - 1;
                                
                                let cellBg = 'transparent';
                                let cellColor = 'rgba(255, 255, 255, 0.12)';
                                let cellFontWeight = 'normal';
                                let cellBorderColor = 'var(--border-light)';
                                
                                if (isLatestDate) {
                                  cellBg = 'rgba(255, 75, 75, 0.85)';
                                  cellColor = '#ffffff';
                                  cellFontWeight = '800';
                                  cellBorderColor = 'rgba(255, 75, 75, 0.6)';
                                } else if (isRainy) {
                                  cellBg = 'rgba(0, 242, 254, 0.18)';
                                  cellColor = 'var(--accent)';
                                  cellFontWeight = '700';
                                  cellBorderColor = 'rgba(0, 242, 254, 0.25)';
                                }

                                return (
                                  <td 
                                    key={dIdx} 
                                    className="matrix-cell"
                                    style={{
                                      padding: '0.12rem 0.05rem',
                                      borderRight: '1px solid var(--border-light)',
                                      background: cellBg,
                                      color: cellColor,
                                      fontWeight: cellFontWeight,
                                      borderRightColor: cellBorderColor,
                                      fontSize: '0.72rem',
                                      boxShadow: isLatestDate ? '0 0 6px rgba(255, 75, 75, 0.4)' : 'none',
                                      position: isLatestDate ? 'relative' : 'static',
                                      zIndex: isLatestDate ? 1 : 'auto'
                                    }}
                                    title={`${dIdx + 1} de ${monthName}: ${val.toFixed(1)} mm${isLatestDate ? ' (Último registro)' : ''}`}
                                  >
                                    {isRainy || isLatestDate ? val.toFixed(1) : 0}
                                    {isLatestDate && (
                                      <span style={{
                                        position: 'absolute',
                                        top: '1px',
                                        right: '1px',
                                        fontSize: '0.4rem',
                                        lineHeight: '1',
                                        fontWeight: '900',
                                        color: '#ffffff',
                                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                        padding: '1px 2px',
                                        borderRadius: '2px',
                                        transform: 'scale(0.8)',
                                        transformOrigin: 'top right',
                                        pointerEvents: 'none',
                                        letterSpacing: '0.1px'
                                      }}>
                                        ÚLT
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                              <td style={{
                                fontWeight: '700',
                                background: 'rgba(255, 255, 255, 0.02)',
                                color: monthTotal > 0 ? 'var(--text-main)' : 'var(--text-muted)',
                                padding: '0.15rem 0.4rem',
                                borderRight: '1px solid var(--border-light)',
                                fontSize: '0.72rem'
                              }}>
                                {monthTotal > 0 ? Math.round(monthTotal) : 0}
                              </td>
                              <td style={{
                                fontWeight: '700',
                                background: 'rgba(255, 255, 255, 0.02)',
                                color: monthEvents > 0 ? 'var(--text-main)' : 'var(--text-muted)',
                                padding: '0.15rem 0.4rem',
                                fontSize: '0.72rem'
                              }}>
                                {monthEvents > 0 ? monthEvents : '-'}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Fila de Totales Generales */}
                        <tr style={{ background: 'rgba(255, 255, 255, 0.04)', fontWeight: '700', borderTop: '2px solid var(--border-light)', fontSize: '0.72rem' }}>
                          <td style={{
                            textAlign: 'left',
                            padding: '0.25rem 0.4rem',
                            borderRight: '1px solid var(--border-light)'
                          }}>TOTAL</td>
                          {Array.from({ length: 31 }, (_, dIdx) => (
                            <td key={dIdx} style={{
                              padding: '0.25rem 0.05rem',
                              borderRight: '1px solid var(--border-light)'
                            }}></td>
                          ))}
                          <td style={{ borderRight: '1px solid var(--border-light)', padding: '0.25rem 0.4rem' }}>{Math.round(matrixData.totalYearPrec)}</td>
                          <td style={{ padding: '0.25rem 0.4rem' }}>{matrixData.totalYearEvents}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Gráfico de Precipitación Promedio Ponderada y Eventos por Mes */}
                <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', width: '100%' }}>
                    <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.1rem', margin: 0 }}>
                      {selectedPluviometro && selectedPluviometro !== 'Todos' ? (
                        `Gráfico: Precipitación / Eventos por Mes (${matrixData.activeYear}) - Pluviómetro ${selectedPluviometro}`
                      ) : (
                        `Gráfico: Precipitación Promedio Ponderada / Eventos por Mes (${matrixData.activeYear}) - ${selectedFinca === 'Todas' ? 'Todas las Fincas' : (FINCA_NAMES[selectedFinca] || `Finca ${selectedFinca}`)}`
                      )}
                    </h4>
                    <button
                      onClick={() => handleDownloadChart(monthlyChartRef, 'grafico_precipitacion_mensual')}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: 0.5,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        transition: 'opacity 0.2s, background 0.2s',
                        outline: 'none'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.background = 'transparent'; }}
                      title="Descargar gráfico como PNG"
                    >
                      <Download size={11} />
                      Descargar
                    </button>
                  </div>
                  <div style={{ height: '350px', position: 'relative', width: '100%' }}>
                    <Chart ref={monthlyChartRef} type="bar" data={chartData} options={chartOptions} plugins={[customDataLabelsPlugin, horizontalLinePlugin]} />
                  </div>
                </section>

                {/* Gráfico Comparativo Anual de Precipitación */}
                <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', width: '100%' }}>
                    <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.1rem', margin: 0 }}>
                      {selectedPluviometro && selectedPluviometro !== 'Todos' ? (
                        `Gráfico: Comparativo Anual de Precipitación - Pluviómetro ${selectedPluviometro}`
                      ) : (
                        `Gráfico: Comparativo Anual de Precipitación - ${selectedFinca === 'Todas' ? 'Todas las Fincas' : (FINCA_NAMES[selectedFinca] || `Finca ${selectedFinca}`)}`
                      )}
                    </h4>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <button
                        onClick={() => handleDownloadChart(comparativeChartRef, `grafico_comparativo_${compareChartType}`)}
                        disabled={selectedCompareAnios.length === 0}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: '0.7rem',
                          cursor: selectedCompareAnios.length === 0 ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          opacity: selectedCompareAnios.length === 0 ? 0.3 : 0.5,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          transition: 'opacity 0.2s, background 0.2s',
                          outline: 'none'
                        }}
                        onMouseEnter={(e) => { if (selectedCompareAnios.length > 0) { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; } }}
                        onMouseLeave={(e) => { if (selectedCompareAnios.length > 0) { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.background = 'transparent'; } }}
                        title="Descargar gráfico como PNG"
                      >
                        <Download size={11} />
                        Descargar
                      </button>

                      <div className="chart-type-toggle">
                        <button 
                          className={`chart-type-btn ${compareChartType === 'bar' ? 'active' : ''}`}
                          onClick={() => setCompareChartType('bar')}
                          title="Gráfico de barras"
                        >
                          <BarChart2 size={14} />
                          Gráfico de barras
                        </button>
                        <button 
                          className={`chart-type-btn ${compareChartType === 'line' ? 'active' : ''}`}
                          onClick={() => setCompareChartType('line')}
                          title="Gráfico de líneas"
                        >
                          <LineChart size={14} />
                          Gráfico de líneas
                        </button>
                      </div>
                    </div>
                  </div>
                  {selectedCompareAnios.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '350px', flexDirection: 'column', gap: '0.5rem', color: 'var(--text-muted)' }}>
                      <Info size={24} />
                      <p>Selecciona al menos un año en el filtro de comparación para visualizar el gráfico.</p>
                    </div>
                  ) : (
                    <div style={{ height: '350px', position: 'relative', width: '100%' }}>
                      <Chart ref={comparativeChartRef} type={compareChartType} data={compareChartData} options={compareChartOptions} plugins={[customDataLabelsPlugin]} />
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
        </div>
        ) : activeTab === 'mapas' ? (
          <div key="mapas" className="tab-content-active" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {(() => {
              if (!activeMapGeoJSON) {
                return (
                  <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <MapPin size={48} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                    <h3>No se ha cargado el mapa de la finca {FINCA_NAMES[REVERSE_FINCA_MAPS_KEYS[activeFincaKey] || activeFincaKey] || activeFincaKey}</h3>
                    <p style={{ color: 'var(--text-muted)', maxWidth: '500px', fontSize: '0.9rem' }}>
                      Para visualizar los lotes y su precipitación, por favor abre la ventana de <strong>Configuración</strong> en la parte superior y sube el archivo GeoJSON correspondiente para esta finca.
                    </p>
                    <button 
                      className="btn btn-primary"
                      onClick={handleOpenSettings}
                      style={{ marginTop: '0.5rem' }}
                    >
                      <Upload size={16} />
                      Subir Mapa GeoJSON
                    </button>
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Panel de Filtros optimizado y angosto para la pestaña Mapas */}
                  <section className="glass-panel" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '1.25rem', padding: '0.65rem 1.25rem', minHeight: 'auto', width: '100%' }}>
                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', width: '100%' }}>
                      
                      {/* Filtro Finca - Limitado únicamente a mapas cargados */}
                      <div className="filter-group" style={{ minWidth: '150px', margin: 0 }}>
                        <label htmlFor="map-finca-select" style={{ fontSize: '0.75rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center' }}>
                          <MapPin size={11} style={{ marginRight: '4px' }} /> Finca
                        </label>
                        <select 
                          id="map-finca-select"
                          className="select-control"
                          value={selectedMapFinca}
                          style={{ height: '34px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                          onChange={(e) => {
                            const code = e.target.value;
                            setSelectedMapFinca(code);
                            
                            // Resolver pluviómetro de forma síncrona
                            let newPluv = 'Todos';
                            if (code !== 'Todas') {
                              const pluvs = [...new Set(records.filter(r => r.finca === code).map(r => r.pluviometro))].sort();
                              if (pluvs.length === 1) {
                                newPluv = pluvs[0];
                              } else if (selectedMapPluviometro !== 'Todos' && pluvs.includes(selectedMapPluviometro)) {
                                newPluv = selectedMapPluviometro;
                              }
                            }
                            setSelectedMapPluviometro(newPluv);
                            
                            // Resolver año de forma síncrona
                            let filtered = records;
                            if (code !== 'Todas') {
                              filtered = filtered.filter(r => r.finca === code);
                            }
                            if (newPluv !== 'Todos') {
                              filtered = filtered.filter(r => r.pluviometro === newPluv);
                            }
                            const availableYears = [...new Set(filtered.map(r => r.anio))].sort((a, b) => b - a);
                            if (availableYears.length > 0 && selectedMapAnio !== 'Todos') {
                              const currentAnioNum = parseInt(selectedMapAnio, 10);
                              if (availableYears.includes(currentAnioNum)) {
                                setSelectedMapAnio(String(currentAnioNum));
                              } else {
                                setSelectedMapAnio(String(availableYears[0]));
                              }
                            }
                            
                            // Resetear mes del mapa al cambiar finca
                            setSelectedMapMes('Todos');
                          }}
                        >
                          {Object.keys(fincaMaps).map(fKey => {
                            const code = REVERSE_FINCA_MAPS_KEYS[fKey] || fKey;
                            return (
                              <option key={fKey} value={code}>
                                {fKey} ({code})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Filtro Pluviómetro */}
                      <div className="filter-group" style={{ minWidth: '160px', margin: 0 }}>
                        <label htmlFor="map-pluv-select" style={{ fontSize: '0.75rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center' }}>
                          <Layers size={11} style={{ marginRight: '4px' }} /> Pluviómetro
                        </label>
                        <select 
                          id="map-pluv-select"
                          className="select-control"
                          value={selectedMapPluviometro}
                          style={{ height: '34px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                          onChange={(e) => {
                            const newPluv = e.target.value;
                            setSelectedMapPluviometro(newPluv);
                            
                            // Resolver año de forma síncrona
                            let filteredForYears = records;
                            if (selectedMapFinca !== 'Todas') {
                              filteredForYears = filteredForYears.filter(r => r.finca === selectedMapFinca);
                            }
                            if (newPluv !== 'Todos') {
                              filteredForYears = filteredForYears.filter(r => r.pluviometro === newPluv);
                            }
                            const availableYears = [...new Set(filteredForYears.map(r => r.anio))].sort((a, b) => b - a);
                            
                            if (availableYears.length > 0 && selectedMapAnio !== 'Todos') {
                              const currentAnioNum = parseInt(selectedMapAnio, 10);
                              if (!availableYears.includes(currentAnioNum)) {
                                setSelectedMapAnio(String(availableYears[0]));
                              }
                            }
                          }}
                          disabled={uniqueMapPluviometros.length === 0}
                        >
                          {(selectedMapFinca === 'Todas' || uniqueMapPluviometros.length > 1) && (
                            <option value="Todos">Todos</option>
                          )}
                          {uniqueMapPluviometros.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>

                      {/* Filtro Año */}
                      <div className="filter-group" style={{ minWidth: '110px', margin: 0 }}>
                        <label htmlFor="map-anio-select" style={{ fontSize: '0.75rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center' }}>
                          <Calendar size={11} style={{ marginRight: '4px' }} /> Año
                        </label>
                        <select 
                          id="map-anio-select"
                          className="select-control"
                          value={selectedMapAnio}
                          style={{ height: '34px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                          onChange={(e) => setSelectedMapAnio(e.target.value)}
                          disabled={uniqueMapAnios.length === 0}
                        >
                          <option value="Todos">Todos</option>
                          {uniqueMapAnios.map(a => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      </div>

                      {/* Filtro Mes */}
                      <div className="filter-group" style={{ minWidth: '130px', margin: 0 }}>
                        <label htmlFor="map-mes-select" style={{ fontSize: '0.75rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center' }}>
                          <Calendar size={11} style={{ marginRight: '4px' }} /> Mes
                        </label>
                        <select 
                          id="map-mes-select"
                          className="select-control"
                          value={selectedMapMes}
                          style={{ height: '34px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                          onChange={(e) => setSelectedMapMes(e.target.value)}
                          disabled={uniqueMapMeses.length === 0}
                        >
                          <option value="Todos">Todos</option>
                          {uniqueMapMeses.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Botón Encender/Apagar Coloreado por Pluviómetro */}
                      <div className="filter-group" style={{ minWidth: '160px', margin: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                        <label style={{ fontSize: '0.75rem', marginBottom: '0.2rem', opacity: 0.8, display: 'flex', alignItems: 'center' }}>
                          <Palette size={11} style={{ marginRight: '4px' }} /> Pluviometría
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const newPluvVal = !showPluvZones;
                            setShowPluvZones(newPluvVal);
                            if (newPluvVal) {
                              setHumDisplayMode('off');
                            }
                          }}
                          className={`btn ${showPluvZones ? 'btn-accent' : 'btn-secondary'}`}
                          style={{
                            height: '34px',
                            padding: '0.25rem 1rem',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            border: showPluvZones ? '1px solid #00f2fe' : '1px solid var(--border-light)',
                            background: showPluvZones ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                            color: showPluvZones ? '#00f2fe' : 'var(--text-main)',
                            transition: 'all 0.25s ease',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer'
                          }}
                        >
                          <span style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: showPluvZones ? '#00f2fe' : '#64748b',
                            boxShadow: showPluvZones ? '0 0 8px #00f2fe' : 'none',
                            transition: 'all 0.25s ease'
                          }}></span>
                          {showPluvZones ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>

                      {/* Botón Encendido/Apagado/Fertilización 3 posiciones para Humedad */}
                      <div className="filter-group" style={{ minWidth: '180px', margin: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                        <label style={{ fontSize: '0.75rem', marginBottom: '0.2rem', opacity: 0.8, display: 'flex', alignItems: 'center' }}>
                          <Layers size={11} style={{ marginRight: '4px' }} /> Humedad / Fertilización
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            let nextMode = 'off';
                            if (humDisplayMode === 'off') {
                              nextMode = 'moisture';
                            } else if (humDisplayMode === 'moisture') {
                              nextMode = 'fertility';
                            }
                            setHumDisplayMode(nextMode);
                            if (nextMode !== 'off') {
                              setShowPluvZones(false);
                            }
                          }}
                          className={`btn ${humDisplayMode !== 'off' ? 'btn-accent' : 'btn-secondary'}`}
                          style={{
                            height: '34px',
                            padding: '0.25rem 0.75rem',
                            fontSize: '0.82rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem',
                            border: humDisplayMode !== 'off' 
                              ? `1px solid ${humDisplayMode === 'fertility' ? '#00e676' : '#00f2fe'}` 
                              : '1px solid var(--border-light)',
                            background: humDisplayMode !== 'off' 
                              ? `rgba(${humDisplayMode === 'fertility' ? '0, 230, 118' : '0, 242, 254'}, 0.12)` 
                              : 'rgba(255, 255, 255, 0.03)',
                            color: humDisplayMode !== 'off' 
                              ? (humDisplayMode === 'fertility' ? '#00e676' : '#00f2fe') 
                              : 'var(--text-main)',
                            transition: 'all 0.25s ease',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer'
                          }}
                        >
                          <span style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: humDisplayMode === 'moisture' 
                              ? '#00f2fe' 
                              : humDisplayMode === 'fertility' 
                              ? '#00e676' 
                              : '#64748b',
                            boxShadow: humDisplayMode === 'moisture' 
                              ? '0 0 8px #00f2fe' 
                              : humDisplayMode === 'fertility' 
                              ? '0 0 8px #00e676' 
                              : 'none',
                            transition: 'all 0.25s ease'
                          }}></span>
                          {humDisplayMode !== 'off' ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>

                      {/* Filtro Monitoreo GPS */}
                      <div className="filter-group" style={{ minWidth: '150px', margin: 0 }}>
                        <label htmlFor="map-gps-select" style={{ fontSize: '0.75rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', color: '#00f2fe' }}>
                          <Compass size={11} style={{ marginRight: '4px' }} /> Monitoreo GPS
                        </label>
                        <select 
                          id="map-gps-select"
                          className="select-control"
                          value={trackActive ? 'Track' : 'Desactivado'}
                          style={{ 
                            height: '34px', 
                            padding: '0.25rem 0.5rem', 
                            fontSize: '0.85rem',
                            borderColor: trackActive ? '#00f2fe' : 'var(--border-light)',
                            background: trackActive ? 'rgba(0, 242, 254, 0.05)' : 'transparent',
                            color: trackActive ? '#00f2fe' : 'var(--text-main)'
                          }}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleToggleTrack(val === 'Track');
                          }}
                        >
                          <option value="Desactivado">Desactivado</option>
                          <option value="Track">Track</option>
                        </select>
                      </div>

                      {/* ⚠️ AVISO PROVISIONAL: Tipo de suelo pendiente — eliminar cuando se entregue el archivo de suelos */}
                      {humDisplayMode !== 'off' && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          background: 'rgba(255, 193, 7, 0.12)',
                          border: '1px solid rgba(255, 193, 7, 0.4)',
                          borderRadius: '6px',
                          padding: '0.35rem 0.7rem',
                          fontSize: '0.72rem',
                          color: '#ffd54f',
                          fontWeight: 500
                        }}>
                          ⚠️ <strong>PENDIENTE:</strong>&nbsp;El tipo de suelo por lote no ha sido configurado. El cálculo de humedad usa suelo&nbsp;<em>Franco (80 mm)</em>&nbsp;provisional para todos los lotes. Para mayor precisión entregue el archivo de tipos de suelo.
                        </div>
                      )}

                    </div>
                  </section>

                  <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                      <div>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.2rem', margin: 0 }}>
                          Mapa de Lotes - Finca {FINCA_NAMES[REVERSE_FINCA_MAPS_KEYS[activeFincaKey] || activeFincaKey] || activeFincaKey}
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem', margin: 0 }}>
                          Mapa interactivo de lotes y distribución de pluviómetros de la finca.
                        </p>
                      </div>

                      {/* Botón de Mapa Satelital */}
                      <button
                        onClick={() => trackActive && setUseSatelliteBackground(!useSatelliteBackground)}
                        disabled={!trackActive}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          background: !trackActive 
                            ? 'rgba(255, 255, 255, 0.02)'
                            : useSatelliteBackground 
                              ? 'rgba(0, 242, 254, 0.12)' 
                              : 'rgba(255, 255, 255, 0.08)',
                          border: !trackActive 
                            ? '1px solid rgba(255, 255, 255, 0.06)'
                            : useSatelliteBackground 
                              ? '1px solid #00f2fe' 
                              : '1px solid rgba(255, 255, 255, 0.2)',
                          color: !trackActive 
                            ? 'var(--text-muted)' 
                            : useSatelliteBackground 
                              ? '#00f2fe' 
                              : '#fff',
                          padding: '0.45rem 1rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          cursor: !trackActive ? 'not-allowed' : 'pointer',
                          transition: 'all 0.25s ease',
                          opacity: !trackActive ? 0.45 : 1,
                          boxShadow: useSatelliteBackground && trackActive ? '0 0 10px rgba(0, 242, 254, 0.1)' : 'none'
                        }}
                        title={!trackActive ? "El fondo satelital solo se puede activar al visualizar un recorrido de monitoreo GPS" : "Alternar fondo del mapa entre vectorial y satélite"}
                      >
                        <Layers size={14} />
                        <span>Fondo Satelital: {useSatelliteBackground && trackActive ? 'ACTIVO' : 'APAGADO'}</span>
                      </button>
                    </div>

                    {/* Diseño en dos columnas: Mapa a la izquierda, Tarjeta a la derecha */}
                    <div style={{ display: 'grid', gridTemplateColumns: '68fr 32fr', gap: '1.5rem', width: '100%' }}>
                      
                      {/* Columna Izquierda: Contenedor del Mapa */}
                      <div style={{ height: '550px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-light)', position: 'relative' }}>
                        <MapContainer 
                          center={[6.2442, -75.5812]} 
                          zoom={13} 
                          zoomSnap={0.1}
                          zoomControl={false}
                          attributionControl={false}
                          doubleClickZoom={true}
                          scrollWheelZoom={true}
                          boxZoom={true}
                          touchZoom={true}
                          dragging={true}
                          keyboard={true}
                          closeTooltipOnClick={false}
                          style={{ height: '100%', width: '100%', background: '#080c14' }}
                        >
                          {useSatelliteBackground && trackActive && (
                            <TileLayer
                              url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                              maxZoom={20}
                              attribution="&copy; Google Maps"
                            />
                          )}
                          <LeafletGeoJSON
                            ref={geoJsonRef}
                            key={`${activeFincaKey}_${showPluvZones}_${humDisplayMode}_${trackActive}`}
                            data={activeMapGeoJSON}
                            style={(feature) => {
                              const isSel = checkIfFeatureIsSelected(feature, selectedLotInfo);
                              const pluvVal = feature.properties.PLUVIOMETR || feature.properties.pluviometro || feature.properties.pluv || feature.properties.pluviometro_lote || feature.properties.PLUVIOMETRO || feature.properties.Pluviometro;
                              
                              let fillColor = 'rgba(0, 242, 254, 0.05)';
                              let borderColor = isSel ? '#00f2fe' : 'rgba(255, 255, 255, 0.2)';
                              let fillOpacity = isSel ? 0.2 : 0.08;
                              let weight = isSel ? 2.5 : 0.8;

                              if (trackActive) {
                                fillColor = 'rgba(56, 189, 248, 0.06)';
                                fillOpacity = 0.06;
                                borderColor = 'rgba(56, 189, 248, 0.45)';
                                weight = 1.1;
                              } else if (showPluvZones) {
                                const pluvColor = getPastelColorForPluviometro(pluvVal);
                                fillColor = pluvColor;
                                fillOpacity = isSel ? 0.35 : 0.16;
                                if (!isSel) {
                                  borderColor = hexToRgba(pluvColor, 0.55);
                                }
                              } else if (humDisplayMode === 'moisture') {
                                const loteKey = getLoteUniqueKey(feature.properties, '');
                                const cadData = mapLotesCad[loteKey];
                                if (cadData) {
                                  fillColor = cadData.level.color;
                                  fillOpacity = isSel ? 0.55 : 0.3;
                                  if (!isSel) {
                                    borderColor = hexToRgba(cadData.level.color, 0.65);
                                  }
                                } else {
                                  fillColor = 'rgba(120, 120, 120, 0.08)';
                                  fillOpacity = 0.08;
                                  borderColor = 'rgba(255, 255, 255, 0.08)';
                                }
                              } else if (humDisplayMode === 'fertility') {
                                const loteKey = getLoteUniqueKey(feature.properties, '');
                                const cadData = mapLotesCad[loteKey];
                                if (cadData) {
                                  fillColor = cadData.fertilizacion.color;
                                  fillOpacity = isSel ? 0.55 : 0.3;
                                  if (!isSel) {
                                    borderColor = hexToRgba(cadData.fertilizacion.color, 0.65);
                                  }
                                } else {
                                  fillColor = 'rgba(120, 120, 120, 0.08)';
                                  fillOpacity = 0.08;
                                  borderColor = 'rgba(255, 255, 255, 0.08)';
                                }
                              }

                              return {
                                fillColor,
                                weight,
                                opacity: 1,
                                color: borderColor,
                                fillOpacity,
                              };
                            }}
                            onEachFeature={(feature, layer) => {
                              const loteName = feature.properties.NOMBRELOTE || feature.properties.nombrelote || feature.properties['NOMBRE LOT'] || feature.properties.lote || feature.properties.LOTE || feature.properties.name || feature.properties.id || '';
                              if (loteName) {
                                const isSel = checkIfFeatureIsSelected(feature, selectedLotInfoRef.current);
                                if (!isSel) {
                                  layer.bindTooltip(loteName, {
                                    permanent: false,
                                    direction: 'center',
                                    sticky: true,
                                    className: 'custom-map-tooltip'
                                  });
                                }
                              }

                              layer.on({
                                mouseover: (e) => {
                                  const l = e.target;
                                  const currentSel = selectedLotInfoRef.current;
                                  const currentIsSel = checkIfFeatureIsSelected(feature, currentSel);
                                  if (!currentIsSel) {
                                    const currentShowZones = showPluvZonesRef.current;
                                    const currentHumMode = humDisplayModeRef.current;
                                    l.setStyle({
                                      weight: 2,
                                      color: '#00f2fe', // Borde azul brillante en hover
                                      fillOpacity: currentShowZones ? 0.28 : currentHumMode !== 'off' ? 0.55 : 0.15
                                    });
                                  }
                                },
                                mouseout: (e) => {
                                  const l = e.target;
                                  const currentSel = selectedLotInfoRef.current;
                                  const currentIsSel = checkIfFeatureIsSelected(feature, currentSel);
                                  if (!currentIsSel) {
                                    const currentShowZones = showPluvZonesRef.current;
                                    const currentHumMode = humDisplayModeRef.current;
                                    const pluvVal = feature.properties.PLUVIOMETR || feature.properties.pluviometro || feature.properties.pluv || feature.properties.pluviometro_lote || feature.properties.PLUVIOMETRO || feature.properties.Pluviometro;
                                    
                                    let fillColor = 'rgba(0, 242, 254, 0.05)';
                                    let borderColor = 'rgba(255, 255, 255, 0.2)';
                                    let fillOpacity = 0.08;
                                    
                                    if (currentShowZones) {
                                      const pluvColor = getPastelColorForPluviometro(pluvVal);
                                      fillColor = pluvColor;
                                      borderColor = hexToRgba(pluvColor, 0.55);
                                      fillOpacity = 0.16;
                                    } else if (currentHumMode === 'moisture') {
                                      const loteKey = getLoteUniqueKey(feature.properties, '');
                                      const cadData = mapLotesCadRef.current[loteKey];
                                      if (cadData) {
                                        fillColor = cadData.level.color;
                                        borderColor = hexToRgba(cadData.level.color, 0.65);
                                        fillOpacity = 0.3;
                                      } else {
                                        fillColor = 'rgba(120, 120, 120, 0.08)';
                                        borderColor = 'rgba(255, 255, 255, 0.08)';
                                        fillOpacity = 0.08;
                                      }
                                    } else if (currentHumMode === 'fertility') {
                                      const loteKey = getLoteUniqueKey(feature.properties, '');
                                      const cadData = mapLotesCadRef.current[loteKey];
                                      if (cadData) {
                                        fillColor = cadData.fertilizacion.color;
                                        borderColor = hexToRgba(cadData.fertilizacion.color, 0.65);
                                        fillOpacity = 0.3;
                                      } else {
                                        fillColor = 'rgba(120, 120, 120, 0.08)';
                                        borderColor = 'rgba(255, 255, 255, 0.08)';
                                        fillOpacity = 0.08;
                                      }
                                    }
                                    
                                    l.setStyle({
                                      weight: 0.8,
                                      color: borderColor,
                                      fillOpacity,
                                      fillColor
                                    });
                                  }
                                },
                                click: (e) => {
                                  if (e) {
                                    if (e.originalEvent && typeof e.originalEvent.stopPropagation === 'function') {
                                      e.originalEvent.stopPropagation();
                                    }
                                    if (typeof e.stopPropagation === 'function') {
                                      e.stopPropagation();
                                    }
                                  }
                                  const prec = getPrecipitationForFeature(feature);
                                  setSelectedLotInfo({
                                    ...feature,
                                    precipitation: prec
                                  });
                                }
                              });
                            }}
                          />

                           {/* Estilos CSS para animaciones de paradas y estaciones */}
                           <style dangerouslySetInnerHTML={{__html: `
                             @keyframes stop-pulse {
                               0% { transform: scale(0.6); opacity: 0.7; }
                               50% { transform: scale(1.3); opacity: 0.2; }
                               100% { transform: scale(0.6); opacity: 0.7; }
                             }
                             @keyframes station-pulse {
                               0% { transform: scale(0.7); opacity: 0.8; }
                               50% { transform: scale(1.25); opacity: 0.15; }
                               100% { transform: scale(0.7); opacity: 0.8; }
                             }
                             .track-playhead-arrow {
                               transition: transform 0.1s linear, top 0.15s ease-out, left 0.15s ease-out;
                             }
                           `}} />

                            {/* Representar recorrido GPS en el mapa */}
                            {trackActive && selectedTrackId && (() => {
                              const track = getActiveTrack(selectedTrackId, mobileTracks, mobileReadings);
                              if (!track || !track.recorrido || track.recorrido.length === 0) return null;
                              const positions = track.recorrido.map(p => [p.lat, p.lon]);
                              return (
                                <Polyline 
                                  positions={positions} 
                                  pathOptions={{ color: '#00f2fe', weight: 4, opacity: 0.85, dashArray: '5, 8' }} 
                                />
                              );
                            })()}

                            {/* Representar paradas prolongadas de inactividad (>2 min) */}
                            {trackActive && selectedTrackId && (() => {
                              const track = getActiveTrack(selectedTrackId, mobileTracks, mobileReadings);
                              if (!track) return null;
                              const stops = detectTrackStops(track);

                              return stops.map((stop, idx) => {
                                const customStopIcon = L.divIcon({
                                  html: `<div style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; position: relative;">
                                    <div style="position: absolute; width: 100%; height: 100%; border-radius: 50%; background: #ff1744; opacity: 0.35; animation: stop-pulse 1.8s infinite ease-in-out;"></div>
                                    <div style="position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #ff1744; border: 1.5px solid #fff; box-shadow: 0 0 5px rgba(0,0,0,0.6);"></div>
                                  </div>`,
                                  className: 'custom-stop-marker',
                                  iconSize: [32, 32],
                                  iconAnchor: [16, 16]
                                });
                                
                                return (
                                  <LeafletMarker
                                    key={`stop-${idx}`}
                                    position={[stop.lat, stop.lon]}
                                    icon={customStopIcon}
                                  >
                                    <LeafletTooltip permanent={false} direction="top">
                                      <span>
                                        🛑 <strong>Parada de {stop.durationMinutes} min</strong><br/>
                                        Inició: {new Date(stop.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </LeafletTooltip>
                                  </LeafletMarker>
                                );
                              });
                            })()}

                            {/* Representar marcadores de lecturas de campo (formularios) georreferenciadas */}
                            {trackActive && selectedTrackId && (() => {
                              const track = getActiveTrack(selectedTrackId, mobileTracks, mobileReadings);
                              if (!track) return null;
                              const trackDateStr = new Date(track.timestamp).toDateString();
                              const readingsOfTrack = mobileReadings.filter(r => 
                                r.usuario === track.usuario && 
                                new Date(r.timestamp).toDateString() === trackDateStr
                              );

                              return readingsOfTrack.map((reading, idx) => {
                                if (!reading.gps) return null;
                                
                                const customStationIcon = L.divIcon({
                                  html: `<div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; position: relative;">
                                    <div style="position: absolute; width: 100%; height: 100%; border-radius: 50%; background: #ff9100; opacity: 0.35; animation: station-pulse 2.2s infinite ease-in-out;"></div>
                                    <div style="position: absolute; width: 7px; height: 7px; border-radius: 50%; background: #fff; border: 2px solid #ff9100; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>
                                  </div>`,
                                  className: 'custom-station-marker',
                                  iconSize: [24, 24],
                                  iconAnchor: [12, 12]
                                });

                                return (
                                  <LeafletMarker
                                    key={`reading-marker-${idx}`}
                                    position={[reading.gps.lat, reading.gps.lon]}
                                    icon={customStationIcon}
                                  >
                                    <LeafletTooltip permanent={false} direction="top">
                                      <span>
                                        <strong>Estación: Palma {reading.palma}</strong><br/>
                                        Lote: {reading.lote} (Lín. {reading.linea})<br/>
                                        Subsector: {reading.subsector}<br/>
                                        {reading.observacion ? `Obs: ${reading.observacion}` : ''}
                                      </span>
                                    </LeafletTooltip>
                                  </LeafletMarker>
                                );
                              });
                            })()}

                            {/* Representar la flechita indicadora del reproductor GPS */}
                            {trackActive && selectedTrackId && (() => {
                              const track = getActiveTrack(selectedTrackId, mobileTracks, mobileReadings);
                              if (!track || !track.recorrido || track.recorrido.length === 0) return null;
                              
                              const index = Math.min(playbackIndex, track.recorrido.length - 1);
                              const nextIndex = Math.min(index + 1, track.recorrido.length - 1);
                              const pt1 = track.recorrido[index];
                              const pt2 = track.recorrido[nextIndex];
                              if (!pt1) return null;

                              // Calcular posición interpolada suave
                              const lat = pt1.lat + (pt2.lat - pt1.lat) * interpolationFactor;
                              const lon = pt1.lon + (pt2.lon - pt1.lon) * interpolationFactor;

                              const bearing = pt1 && pt2 && index !== nextIndex 
                                ? calculateBearing(pt1.lat, pt1.lon, pt2.lat, pt2.lon) 
                                : 0;

                              const arrowIcon = L.divIcon({
                                html: `<div style="transform: rotate(${bearing}deg); font-size: 22px; color: #00f2fe; text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px #00f2fe; line-height: 1; display: flex; align-items: center; justify-content: center;" class="track-playhead-arrow">➤</div>`,
                                className: 'playhead-arrow-marker',
                                iconSize: [26, 26],
                                iconAnchor: [13, 13]
                              });

                              return (
                                <LeafletMarker
                                  position={[lat, lon]}
                                  icon={arrowIcon}
                                  zIndexOffset={1500}
                                />
                              );
                            })()}

                           {selectedLotCenter && !trackActive && (
                             <LeafletCircleMarker
                               center={selectedLotCenter}
                               radius={0}
                               pathOptions={{ stroke: false, fill: false }}
                             >
                               <LeafletTooltip
                                 permanent={true}
                                 direction="center"
                                 className="custom-map-tooltip"
                               >
                                 {selectedLotInfo.properties.NOMBRELOTE || selectedLotInfo.properties.nombrelote || selectedLotInfo.properties['NOMBRE LOT'] || selectedLotInfo.properties.lote || selectedLotInfo.properties.LOTE || selectedLotInfo.properties.name || selectedLotInfo.properties.id || ''}
                               </LeafletTooltip>
                             </LeafletCircleMarker>
                           )}
                           
                            <MapInteractionController active={trackActive} />

                            {!trackActive || !selectedTrackId ? (
                              <FitMapBounds geojson={activeMapGeoJSON} triggerReset={`${trackActive}_${selectedTrackId}`} />
                            ) : (
                              (() => {
                                const track = getActiveTrack(selectedTrackId, mobileTracks, mobileReadings);
                                return <FitTrackBounds track={track} />;
                              })()
                            )}
</MapContainer>
                      </div>

                      {/* Columna Derecha: Tarjeta de Detalles del Lote o Finca */}
                      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: '1rem 1.15rem', height: '550px', overflowY: 'auto', border: '1px solid var(--border-light)', gap: '0.8rem', background: 'rgba(15, 23, 42, 0.4)' }}>
                        {trackActive ? (
                          selectedTrackId ? (
                            // Vista de Detalles del Track Seleccionado
                            (() => {
                              const track = mobileTracks.find(t => t.id === selectedTrackId);
                              if (!track) return <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Track no encontrado</div>;
                              
                              const trackDate = new Date(track.timestamp);
                              const formattedDate = trackDate.toLocaleString('es-ES', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                              });

                              // Calcular paradas prolongadas
                              const stops = detectTrackStops(track);

                              // Filtrar lecturas del mismo usuario en el mismo día
                              const trackDateStr = trackDate.toDateString();
                              const readingsOfTrack = mobileReadings.filter(r => 
                                r.usuario === track.usuario && 
                                new Date(r.timestamp).toDateString() === trackDateStr
                              );

                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.7rem', minHeight: 0 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.45rem', flexShrink: 0 }}>
                                    <button 
                                      onClick={() => {
                                        setSelectedTrackId(null);
                                        setPlaybackIndex(0);
                                        setIsPlaying(false);
                                      }}
                                      style={{ background: 'transparent', border: 'none', color: '#00f2fe', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: 0 }}
                                    >
                                      <ArrowLeft size={14} /> Volver a lista
                                    </button>
                                    <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>Monitoreo GPS</span>
                                  </div>

                                  {/* Encabezado del Recorrido */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem', background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px', borderLeft: '3px solid #00f2fe', flexShrink: 0 }}>
                                    <div style={{ color: 'var(--text-muted)' }}>Operador: <strong style={{ color: '#fff' }}>{track.usuario || 'admin'}</strong></div>
                                    <div style={{ color: 'var(--text-muted)' }}>Fecha: <strong style={{ color: '#fff' }}>{formattedDate}</strong></div>
                                    <div style={{ color: 'var(--text-muted)' }}>Puntos: <strong style={{ color: '#fff' }}>{track.recorrido ? track.recorrido.length : 0}</strong></div>
                                  </div>

                                  {/* Reproductor / Slider de Línea de Tiempo */}
                                  {track.recorrido && track.recorrido.length > 0 && (
                                    <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '0.6rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', flexShrink: 0 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#00f2fe' }}>Línea de Tiempo</span>
                                        <button 
                                          onClick={() => setIsPlaying(prev => !prev)} 
                                          style={{
                                            background: isPlaying ? 'rgba(255, 23, 68, 0.15)' : 'rgba(0, 242, 254, 0.12)',
                                            border: isPlaying ? '1px solid #ff1744' : '1px solid #00f2fe',
                                            color: isPlaying ? '#ff1744' : '#00f2fe',
                                            cursor: 'pointer',
                                            padding: '0.2rem 0.5rem',
                                            borderRadius: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            fontSize: '0.68rem',
                                            fontWeight: 'bold',
                                            transition: 'all 0.2s'
                                          }}
                                        >
                                          {isPlaying ? <Pause size={10} /> : <Play size={10} />}
                                          {isPlaying ? 'Pausar' : 'Reproducir'}
                                        </button>
                                      </div>
                                      
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <input 
                                          type="range"
                                          min={0}
                                          max={track.recorrido.length - 1}
                                          value={playbackIndex}
                                          onChange={(e) => {
                                            setPlaybackIndex(parseInt(e.target.value, 10));
                                            setIsPlaying(false);
                                          }}
                                          style={{
                                            flex: 1,
                                            accentColor: '#00f2fe',
                                            height: '4px',
                                            borderRadius: '2px',
                                            cursor: 'pointer'
                                          }}
                                        />
                                      </div>

                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                        <span>Inicio</span>
                                        <span style={{ color: '#fff', fontWeight: 600 }}>
                                          {new Date(track.recorrido[playbackIndex]?.timestamp || track.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                        <span>Fin</span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Listado de Paradas e inactividad detectada */}
                                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
                                    
                                    {/* Sección Paradas Prolongadas */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: '#ff1744', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Paradas / Tiempos Muertos ({stops.length})
                                      </span>
                                      {stops.length === 0 ? (
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0, fontStyle: 'italic' }}>No se registraron paradas prolongadas en este recorrido.</p>
                                      ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                          {stops.map((stop, idx) => {
                                            const stopTime = new Date(stop.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                            
                                            // Encontrar índice más cercano para snapping
                                            const snapToStopIndex = () => {
                                              const nearestIdx = track.recorrido.reduce((nearest, point, idx) => {
                                                const diffCurrent = Math.abs(point.timestamp - stop.startTime);
                                                const diffNearest = Math.abs(track.recorrido[nearest].timestamp - stop.startTime);
                                                return diffCurrent < diffNearest ? idx : nearest;
                                              }, 0);
                                              setPlaybackIndex(nearestIdx);
                                              setIsPlaying(false);
                                            };

                                            return (
                                              <div 
                                                key={idx} 
                                                onClick={snapToStopIndex}
                                                style={{ 
                                                  display: 'flex', 
                                                  justifyContent: 'space-between', 
                                                  alignItems: 'center', 
                                                  background: 'rgba(255, 23, 68, 0.08)', 
                                                  border: '1px solid rgba(255, 23, 68, 0.2)', 
                                                  padding: '0.3rem 0.5rem', 
                                                  borderRadius: '4px', 
                                                  fontSize: '0.72rem', 
                                                  cursor: 'pointer',
                                                  transition: 'all 0.2s' 
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#ff1744'}
                                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255, 23, 68, 0.2)'}
                                              >
                                                <span style={{ color: '#ff8a80', fontWeight: 'bold' }}>🛑 Parada a las {stopTime}</span>
                                                <span style={{ background: '#ff1744', color: '#fff', fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>{stop.durationMinutes} min</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>

                                    {/* Sección Lecturas Registradas */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.2rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: '#ff9100', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Estaciones de Registro ({readingsOfTrack.length})
                                      </span>
                                      {readingsOfTrack.length === 0 ? (
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0, fontStyle: 'italic' }}>No se enviaron lecturas de campo en esta jornada.</p>
                                      ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                          {readingsOfTrack.map((reading, idx) => {
                                            const snapToReadingIndex = () => {
                                              if (!reading.gps) return;
                                              const nearestIdx = track.recorrido.reduce((nearest, point, idx) => {
                                                const diffCurrent = Math.abs(point.timestamp - reading.timestamp);
                                                const diffNearest = Math.abs(track.recorrido[nearest].timestamp - reading.timestamp);
                                                return diffCurrent < diffNearest ? idx : nearest;
                                              }, 0);
                                              setPlaybackIndex(nearestIdx);
                                              setIsPlaying(false);
                                            };

                                            return (
                                              <div 
                                                key={idx} 
                                                onClick={snapToReadingIndex}
                                                style={{ 
                                                  background: 'rgba(0,0,0,0.2)', 
                                                  border: '1px solid var(--border-light)', 
                                                  borderRadius: '6px', 
                                                  padding: '0.45rem', 
                                                  display: 'flex', 
                                                  flexDirection: 'column', 
                                                  gap: '0.15rem', 
                                                  cursor: 'pointer',
                                                  transition: 'all 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#ff9100'}
                                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-light)'}
                                              >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                                                  <span style={{ color: '#ff9100', fontWeight: 'bold' }}>Finca {reading.finca} · Lote {reading.lote}</span>
                                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Palma {reading.palma} · Lín. {reading.linea}</span>
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>
                                                  Subsector: <strong style={{ color: '#fff' }}>{reading.subsector}</strong>
                                                </div>
                                                {reading.observacion ? (
                                                  <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.68rem', color: '#fff', background: 'rgba(255,255,255,0.03)', padding: '2px 5px', borderRadius: '3px', fontStyle: 'italic' }}>
                                                    Obs: {reading.observacion}
                                                  </p>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>

                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            // Vista de Listado de Tracks disponibles
                            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.8rem', minHeight: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.45rem', flexShrink: 0 }}>
                                <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', color: '#00f2fe', fontWeight: 600, fontSize: '0.95rem' }}>
                                  Recorridos GPS (Campo)
                                </h4>
                                <button
                                  onClick={fetchTracksAndReadings}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#00f2fe',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '0.72rem',
                                    padding: 0
                                  }}
                                >
                                  <RefreshCw size={11} /> Actualizar
                                </button>
                              </div>
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0, flexShrink: 0 }}>
                                Selecciona un recorrido de operador para ver su caminata y paradas en el mapa.
                              </p>
                              
                              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.55rem', marginTop: '0.2rem' }}>
                                {(() => {
                                  // Generar listado unificado de jornadas de operarios (tracks y lecturas)
                                  const list = [];
                                  
                                  // 1. Agregar desde los recorridos GPS existentes
                                  mobileTracks.forEach(t => {
                                    const dateStr = new Date(t.timestamp).toDateString();
                                    list.push({
                                      id: t.id,
                                      usuario: t.usuario || 'admin',
                                      timestamp: t.timestamp,
                                      dateStr,
                                      hasTrack: true,
                                      pointsCount: t.recorrido ? t.recorrido.length : 0
                                    });
                                  });

                                  // 2. Agregar desde las lecturas de campo que no tengan track directo
                                  mobileReadings.forEach(r => {
                                    const dateStr = new Date(r.timestamp).toDateString();
                                    const match = list.find(item => item.usuario === r.usuario && item.dateStr === dateStr);
                                    if (!match) {
                                      list.push({
                                        id: `readings-${r.usuario || 'admin'}-${r.timestamp}`,
                                        usuario: r.usuario || 'admin',
                                        timestamp: r.timestamp,
                                        dateStr,
                                        hasTrack: false,
                                        pointsCount: 0
                                      });
                                    }
                                  });

                                  // Ordenar por fecha más reciente
                                  list.sort((a, b) => b.timestamp - a.timestamp);

                                  if (list.length === 0) {
                                    return <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic', textAlign: 'center', marginTop: '2rem' }}>No hay recorridos sincronizados en la nube.</div>;
                                  }

                                  return list.map(jornada => {
                                    const date = new Date(jornada.timestamp);
                                    const formattedDate = date.toLocaleString('es-ES', {
                                      day: 'numeric',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    });
                                    
                                    // Buscar cuántas lecturas tiene esta jornada
                                    const readingsCount = mobileReadings.filter(r => 
                                      r.usuario === jornada.usuario && 
                                      new Date(r.timestamp).toDateString() === jornada.dateStr
                                    ).length;

                                    return (
                                      <button
                                        key={jornada.id}
                                        onClick={() => {
                                          setSelectedTrackId(jornada.id);
                                          setPlaybackIndex(0);
                                          setIsPlaying(false);
                                        }}
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          background: 'rgba(255,255,255,0.03)',
                                          border: '1px solid var(--border-light)',
                                          borderRadius: '6px',
                                          padding: '0.6rem 0.8rem',
                                          alignItems: 'flex-start',
                                          width: '100%',
                                          cursor: 'pointer',
                                          textAlign: 'left',
                                          transition: 'all 0.2s ease',
                                          gap: '0.2rem'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#00f2fe'}
                                        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-light)'}
                                      >
                                        <span style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 'bold' }}>Usuario: {jornada.usuario}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Sincronizado: {formattedDate}</span>
                                        <div style={{ display: 'flex', gap: '0.45rem', fontSize: '0.7rem', fontWeight: 600, marginTop: '0.15rem' }}>
                                          <span style={{ color: '#00f2fe' }}>
                                            {jornada.hasTrack ? `${jornada.pointsCount} puntos GPS` : 'Recorrido simulado'}
                                          </span>
                                          <span style={{ color: 'rgba(255,255,255,0.45)' }}>·</span>
                                          <span style={{ color: '#ff9100' }}>
                                            {readingsCount} lecturas
                                          </span>
                                        </div>
                                      </button>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          )
                        ) : selectedLotInfo ? (
                          (() => {
                            const props = selectedLotInfo.properties || {};
                            const lote = props.NOMBRELOTE || props.nombrelote || props['NOMBRE LOT'] || props.lote || props.LOTE || props.name || props.id || 'N/A';
                            const area = getAreaFromProperties(props).toFixed(1);
                            const pluv = normalizePluviometroName(props.PLUVIOMETR || props.pluviometro || props.pluv || props.pluviometro_lote || props.PLUVIOMETRO || 'N/A');
                            const subsector = props.SUBSECTOR || 'N/A';
                            const material = props.MATERIAL || 'N/A';
                            const siembra = props.SIEMBRA || 'N/A';
                            const plantas = props['PLANTAS IN'] || 'N/A';
                            const censo = props['CENSO 2015'] || 'N/A';
                            const estado = props.ESTADO_NM || 'N/A';
                            const fechaSiembra = props['FECHA DE S'] || 'N/A';
                            const prec = selectedLotInfo.precipitation;
                            
                            const rainColor = prec === 0 ? '#64748b' :
                                              prec > 150 ? '#00f2fe' :
                                              prec > 50 ? '#06b6d4' :
                                                          '#34d399';
                            
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.45rem', marginBottom: '0.45rem' }}>
                                  <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', color: 'var(--accent)', fontWeight: 600, fontSize: '0.95rem' }}>
                                    Lote: {lote}
                                  </h4>
                                  <button 
                                    className="btn btn-outline"
                                    onClick={() => setSelectedLotInfo(null)}
                                    style={{ padding: '0.15rem 0.5rem', fontSize: '0.68rem', borderRadius: '4px', height: 'auto', border: '1px solid var(--border-light)', background: 'transparent', color: '#fff', cursor: 'pointer' }}
                                  >
                                    Ver Finca
                                  </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.75rem', flex: 1, overflowY: 'auto' }}>
                                  {/* HDR y Fertilización de este lote si está disponible */}
                                  {(() => {
                                    const loteKey = getLoteUniqueKey(props, '');
                                    const cadData = mapLotesCad[loteKey];
                                    if (cadData) {
                                      return (
                                        <>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0, 242, 254, 0.06)', padding: '3px 6px', borderRadius: '4px', borderLeft: `3px solid ${cadData.level.color}` }}>
                                            <span style={{ color: 'var(--text-muted)' }}>Humedad (HDR):</span>
                                            <span style={{ fontWeight: 700, color: cadData.level.color }}>
                                              {cadData.pct.toFixed(0)}% — {cadData.level.label} {cadData.level.icon}
                                            </span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', background: `${cadData.fertilizacion.color}14`, padding: '3px 6px', borderRadius: '4px', borderLeft: `3px solid ${cadData.fertilizacion.color}` }}>
                                            <span style={{ color: 'var(--text-muted)' }}>Viable Fertilizar:</span>
                                            <span style={{ fontWeight: 700, color: cadData.fertilizacion.color }}>
                                              {cadData.fertilizacion.label === 'Viable' ? 'SÍ ✅ Óptimo' : `NO ⚠ ${cadData.fertilizacion.label.replace('No Viable - ', '')}`}
                                            </span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem', padding: '2px 6px' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>Tipo de Suelo:</span>
                                            <span style={{ fontWeight: 600, color: '#fff' }}>{cadData.suelo}</span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem', padding: '2px 6px' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>Cap. Máx. Suelo:</span>
                                            <span style={{ fontWeight: 600, color: '#fff' }}>{cadData.capacidad} mm · {cadData.reserve.toFixed(1)} mm actual</span>
                                          </div>
                                        </>
                                      );
                                    }
                                    return null;
                                  })()}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Pluviómetro:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{pluv}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Precipitación:</span>
                                    <span style={{ fontWeight: 700, color: rainColor }}>{prec.toFixed(1)} mm</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Área Lote:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{area} Ha</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Subsector:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{subsector}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Material:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{material}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Año Siembra:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{siembra}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>F. Siembra:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{fechaSiembra}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Estado:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{estado}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Plantas:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{plantas}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Censo 2015:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{censo}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          (() => {
                            const totalArea = activeMapGeoJSON.features.reduce((sum, f) => {
                              return sum + getAreaFromProperties(f.properties);
                            }, 0);
                            
                            const pluvPrecipVals = activePluvs.map(p => {
                              const data = mapPluviometroPrecipitations[String(p).trim().toLowerCase()];
                              return data ? data.totalPrec : 0;
                            });
                            
                            const avgPrec = pluvPrecipVals.length > 0 ? (pluvPrecipVals.reduce((a, b) => a + b, 0) / pluvPrecipVals.length) : 0;

                            // Calcular distribución de Humedad (HDR) y Fertilización de la finca si corresponde
                            const cadCounts = { 'Óptimo': { count: 0, area: 0 }, 'Atención': { count: 0, area: 0 }, 'Estrés': { count: 0, area: 0 }, 'Estrés Severo': { count: 0, area: 0 }, 'Sin Datos': { count: 0, area: 0 } };
                            const fertilityCounts = { 'Viable': { count: 0, area: 0 }, 'No Viable - Suelo Seco': { count: 0, area: 0 }, 'No Viable - Exceso Humedad': { count: 0, area: 0 }, 'Sin Datos': { count: 0, area: 0 } };
                            let totalLotsWithCad = 0;
                            let totalAreaWithCad = 0;
                            
                            if (humDisplayMode !== 'off') {
                              activeMapGeoJSON.features.forEach((f, idx) => {
                                const loteKey = getLoteUniqueKey(f.properties, idx);
                                const cadData = mapLotesCad[loteKey];
                                const area = getAreaFromProperties(f.properties);
                                
                                if (cadData) {
                                  const lbl = cadData.level.label;
                                  cadCounts[lbl].count += 1;
                                  cadCounts[lbl].area += area;

                                  const fertLbl = cadData.fertilizacion.label;
                                  fertilityCounts[fertLbl].count += 1;
                                  fertilityCounts[fertLbl].area += area;

                                  totalLotsWithCad += 1;
                                  totalAreaWithCad += area;
                                } else {
                                  cadCounts['Sin Datos'].count += 1;
                                  cadCounts['Sin Datos'].area += area;
                                  fertilityCounts['Sin Datos'].count += 1;
                                  fertilityCounts['Sin Datos'].area += area;
                                  totalLotsWithCad += 1;
                                  totalAreaWithCad += area;
                                }
                              });
                            }

                            if (humDisplayMode === 'moisture') {
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.5rem', minHeight: 0 }}>
                                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.4rem' }}>
                                    <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>
                                      Finca: {FINCA_NAMES[REVERSE_FINCA_MAPS_KEYS[activeFincaKey] || activeFincaKey] || activeFincaKey}
                                    </h4>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Consolidado HDR (Suelo)</span>
                                  </div>

                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.76rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                      <span style={{ color: 'var(--text-muted)' }}>Lotes Totales:</span>
                                      <span style={{ fontWeight: 600, color: '#fff' }}>{activeMapGeoJSON.features.length}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                      <span style={{ color: 'var(--text-muted)' }}>Área Total:</span>
                                      <span style={{ fontWeight: 600, color: '#fff' }}>{totalArea.toFixed(1)} Ha</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                      <span style={{ color: 'var(--text-muted)' }}>Año Referencia:</span>
                                      <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                                        {selectedMapAnio === 'Todos' ? `${new Date().getFullYear()} (Reciente)` : selectedMapAnio}
                                      </span>
                                    </div>
                                  </div>

                                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem', minHeight: 0 }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                      Distribución Estado de Suelo
                                    </span>
                                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.45rem', paddingRight: '4px' }}>
                                      {ESTRES_NIVELES.map(level => {
                                        const stats = cadCounts[level.label] || { count: 0, area: 0 };
                                        const pctArea = totalArea > 0 ? (stats.area / totalArea) * 100 : 0;
                                        return (
                                          <div key={level.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', alignItems: 'center' }}>
                                              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: level.color }}></span>
                                                {level.label}
                                              </span>
                                              <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                                                {stats.count} lotes ({stats.area.toFixed(1)} Ha · {pctArea.toFixed(1)}%)
                                              </span>
                                            </div>
                                            <div style={{ width: '100%', height: '4.5px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                              <div style={{ width: `${pctArea}%`, height: '100%', background: level.color, borderRadius: '2px' }} />
                                            </div>
                                          </div>
                                        );
                                      })}
                                      {cadCounts['Sin Datos'].count > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', alignItems: 'center' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: 'var(--text-muted)' }}>
                                              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }}></span>
                                              Sin Datos / Inactivos
                                            </span>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                                              {cadCounts['Sin Datos'].count} lotes ({cadCounts['Sin Datos'].area.toFixed(1)} Ha)
                                            </span>
                                          </div>
                                          <div style={{ width: '100%', height: '4.5px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                            <div style={{ width: `${totalArea > 0 ? (cadCounts['Sin Datos'].area / totalArea) * 100 : 0}%`, height: '100%', background: '#64748b', borderRadius: '2px' }} />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Guía de Interpretación HDR en el espacio inferior */}
                                  <div style={{ marginTop: 'auto', paddingTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>
                                      Guía de Humedad Disponible Real (HDR)
                                    </span>
                                    <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: '1.25' }}>
                                      El mapa colorea los lotes según el porcentaje de <strong>Humedad Disponible Real (HDR)</strong>. La retención varía por tipo de suelo:
                                    </p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 6px', marginTop: '0.3rem', marginBottom: '0.3rem', fontSize: '0.68rem', color: '#fff' }}>
                                      <div>🪨 <strong>Arcilloso:</strong> 120 mm</div>
                                      <div>🌱 <strong>Franco:</strong> 80 mm</div>
                                      <div>🌾 <strong>Fr.-Arcilloso:</strong> 100 mm</div>
                                      <div>⏳ <strong>Fr.-Arenoso:</strong> 60 mm</div>
                                    </div>
                                    <p style={{ fontSize: '0.68rem', color: 'var(--accent)', margin: 0, lineHeight: '1.25' }}>
                                      <strong>Semáforo:</strong> Verde (Óptimo, &gt;60%), Amarillo (Atención, 40-60%), Rojo (Estrés, 20-40%) y Morado (Estrés Severo, &lt;20%).
                                    </p>
                                  </div>
                                </div>
                              );
                            }

                            if (humDisplayMode === 'fertility') {
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.5rem', minHeight: 0 }}>
                                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.4rem' }}>
                                    <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>
                                      Finca: {FINCA_NAMES[REVERSE_FINCA_MAPS_KEYS[activeFincaKey] || activeFincaKey] || activeFincaKey}
                                    </h4>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Consolidado Fertilización</span>
                                  </div>

                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.76rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                      <span style={{ color: 'var(--text-muted)' }}>Lotes Totales:</span>
                                      <span style={{ fontWeight: 600, color: '#fff' }}>{activeMapGeoJSON.features.length}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                      <span style={{ color: 'var(--text-muted)' }}>Área Total:</span>
                                      <span style={{ fontWeight: 600, color: '#fff' }}>{totalArea.toFixed(1)} Ha</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                      <span style={{ color: 'var(--text-muted)' }}>Año Referencia:</span>
                                      <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                                        {selectedMapAnio === 'Todos' ? `${new Date().getFullYear()} (Reciente)` : selectedMapAnio}
                                      </span>
                                    </div>
                                  </div>

                                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem', minHeight: 0 }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                      Distribución de Lotes para Abonar
                                    </span>
                                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.45rem', paddingRight: '4px' }}>
                                      {Object.keys(FERTILIZACION_NIVELES).map(key => {
                                        const level = FERTILIZACION_NIVELES[key];
                                        const stats = fertilityCounts[level.label] || { count: 0, area: 0 };
                                        const pctArea = totalArea > 0 ? (stats.area / totalArea) * 100 : 0;
                                        return (
                                          <div key={level.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', alignItems: 'center' }}>
                                              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: level.color }}></span>
                                                {level.label.replace('No Viable - ', 'No Viable: ')}
                                              </span>
                                              <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                                                {stats.count} lotes ({stats.area.toFixed(1)} Ha · {pctArea.toFixed(1)}%)
                                              </span>
                                            </div>
                                            <div style={{ width: '100%', height: '4.5px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                              <div style={{ width: `${pctArea}%`, height: '100%', background: level.color, borderRadius: '2px' }} />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Guía de Fertilización en el espacio inferior */}
                                  <div style={{ marginTop: 'auto', paddingTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>
                                      Criterio de Viabilidad de Fertilización
                                    </span>
                                    <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: '1.25' }}>
                                      Para que el fertilizante se disuelva y absorba sin lavado o volatilización:
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5px', marginTop: '0.3rem', fontSize: '0.68rem' }}>
                                      <div>🟢 <strong style={{ color: '#00e676' }}>Viable (40% - 80%):</strong> Humedad ideal para absorber el abono.</div>
                                      <div>🟠 <strong style={{ color: '#ff9100' }}>Suelo Seco (&lt;40%):</strong> Abono no se disuelve y se volatiliza.</div>
                                      <div>🔵 <strong style={{ color: '#2979ff' }}>Exceso (&gt;80%):</strong> Alto riesgo de lavado/escurrimiento por lluvias.</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.5rem', minHeight: 0 }}>
                                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.4rem' }}>
                                  <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>
                                    Finca: {FINCA_NAMES[REVERSE_FINCA_MAPS_KEYS[activeFincaKey] || activeFincaKey] || activeFincaKey}
                                  </h4>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Consolidado general</span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.76rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Lotes Totales:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{activeMapGeoJSON.features.length}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Área Total:</span>
                                    <span style={{ fontWeight: 600, color: '#fff' }}>{totalArea.toFixed(1)} Ha</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Lluvia Promedio:</span>
                                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{avgPrec.toFixed(1)} mm</span>
                                  </div>
                                </div>

                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem', minHeight: 0 }}>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Pluviómetros ({activePluvs.length})
                                  </span>
                                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '4px' }}>
                                    {activePluvs.sort().map(p => {
                                      const data = mapPluviometroPrecipitations[String(p).trim().toLowerCase()];
                                      const pPrec = data ? data.totalPrec : 0;
                                      return (
                                        <div 
                                          key={p}
                                          onClick={() => {
                                            setSelectedPluviometro(p);
                                            setSelectedFinca(selectedMapFinca);
                                            setActiveTab('pluviometrico');
                                          }}
                                          style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            background: 'rgba(255,255,255,0.03)', 
                                            padding: '0.3rem 0.5rem', 
                                            borderRadius: '4px', 
                                            fontSize: '0.74rem',
                                            cursor: 'pointer',
                                            border: '1px solid transparent',
                                            transition: 'all 0.2s'
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                            e.currentTarget.style.borderColor = 'transparent';
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                                            {showPluvZones && (
                                              <span style={{
                                                 display: 'inline-block',
                                                 width: '10px',
                                                 height: '10px',
                                                 borderRadius: '2.5px',
                                                 flexShrink: 0,
                                                 background: getPastelColorForPluviometro(p),
                                                 border: '1px solid rgba(255, 255, 255, 0.2)'
                                               }}></span>
                                            )}
                                            <span style={{ color: 'rgba(255, 255, 255, 0.9)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{p}</span>
                                          </div>
                                          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{pPrec.toFixed(1)} mm</span>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Guía de Interpretación de Pluviómetros en el espacio inferior */}
                                  <div style={{ marginTop: 'auto', paddingTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>
                                      Zonas de Influencia
                                    </span>
                                    <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: '1.25' }}>
                                      Cada color en el mapa delimita la cobertura de un <strong>pluviómetro</strong>. Comparten la misma lectura de lluvia en el balance de agua del suelo.
                                    </p>
                                    <p style={{ fontSize: '0.68rem', color: 'var(--primary)', marginTop: '0.3rem', marginBlockEnd: 0, lineHeight: '1.25' }}>
                                      💡 Haz clic en cualquier lote del mapa para ver sus detalles agronómicos individuales.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>

                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div key="balance" className="tab-content tab-content-active" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

            {records.length === 0 ? (
              <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <Info size={48} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                <h3>No se han cargado datos históricos</h3>
                <p style={{ color: 'var(--text-muted)', maxWidth: '500px', fontSize: '0.9rem' }}>
                  Por favor, sube un archivo Excel con registros históricos en la pestaña de <strong>Monitoreo Pluviómetro</strong>.
                </p>
              </div>
            ) : (
              <>
                {/* Panel de Filtros — Balance */}
                <section className="glass-panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', padding: '0.5rem 1rem', minHeight: 'auto' }}>

                  {/* Filtro Finca — solo finca por finca, sin opción "Todas" */}
                  <div className="filter-group" style={{ minWidth: '130px', margin: 0 }}>
                    <label htmlFor="balance-finca-select" style={{ fontSize: '0.7rem', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <MapPin size={10} /> Finca
                    </label>
                    <select
                      id="balance-finca-select"
                      className="select-control"
                      value={selectedBalanceFinca === 'Todas' ? (uniqueBalanceFincas[0] || '') : selectedBalanceFinca}
                      style={{ height: '30px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                      onChange={(e) => {
                        const newFinca = e.target.value;
                        setSelectedBalanceFinca(newFinca);
                        
                        // Resolver pluviómetro de forma síncrona
                        let newPluv = 'Todos';
                        const pluvs = [...new Set(records.filter(r => r.finca === newFinca).map(r => r.pluviometro))].sort();
                        if (pluvs.length === 1) {
                          newPluv = pluvs[0];
                        } else if (selectedBalancePluviometro !== 'Todos' && pluvs.includes(selectedBalancePluviometro)) {
                          newPluv = selectedBalancePluviometro;
                        }
                        setSelectedBalancePluviometro(newPluv);
                        
                        // Resolver año de forma síncrona
                        let filtered = records.filter(r => r.finca === newFinca);
                        if (newPluv !== 'Todos') {
                          filtered = filtered.filter(r => r.pluviometro === newPluv);
                        }
                        const availableYears = [...new Set(filtered.map(r => r.anio))].sort((a, b) => b - a);
                        if (availableYears.length > 0) {
                          const currentAnioNum = parseInt(selectedBalanceAnio, 10);
                          if (availableYears.includes(currentAnioNum)) {
                            setSelectedBalanceAnio(String(currentAnioNum));
                          } else {
                            setSelectedBalanceAnio(String(availableYears[0]));
                          }
                        } else {
                          setSelectedBalanceAnio('');
                        }
                      }}
                    >
                      {uniqueBalanceFincas.map(f => (
                        <option key={f} value={f}>
                          {FINCA_NAMES[f] || `Finca ${f}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Filtro Pluviómetro */}
                  <div className="filter-group" style={{ minWidth: '140px', margin: 0 }}>
                    <label htmlFor="balance-pluv-select" style={{ fontSize: '0.7rem', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Layers size={10} /> Pluviómetro
                    </label>
                    <select
                      id="balance-pluv-select"
                      className="select-control"
                      value={selectedBalancePluviometro}
                      style={{ height: '30px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                      onChange={(e) => {
                        const newPluv = e.target.value;
                        setSelectedBalancePluviometro(newPluv);
                        
                        // Resolver año de forma síncrona
                        let filtered = records.filter(r => r.finca === selectedBalanceFinca);
                        if (newPluv !== 'Todos') {
                          filtered = filtered.filter(r => r.pluviometro === newPluv);
                        }
                        const availableYears = [...new Set(filtered.map(r => r.anio))].sort((a, b) => b - a);
                        if (availableYears.length > 0) {
                          const currentAnioNum = parseInt(selectedBalanceAnio, 10);
                          if (availableYears.includes(currentAnioNum)) {
                            setSelectedBalanceAnio(String(currentAnioNum));
                          } else {
                            setSelectedBalanceAnio(String(availableYears[0]));
                          }
                        } else {
                          setSelectedBalanceAnio('');
                        }
                      }}
                      disabled={uniqueBalancePluviometros.length === 0}
                    >
                      {uniqueBalancePluviometros.length > 1 && (
                        <option value="Todos">Todos</option>
                      )}
                      {uniqueBalancePluviometros.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>

                  {/* Filtro Año — independiente, sin opción "Todos" */}
                  <div className="filter-group" style={{ minWidth: '100px', margin: 0 }}>
                    <label htmlFor="balance-anio-select" style={{ fontSize: '0.7rem', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Calendar size={10} /> Año
                    </label>
                    <select
                      id="balance-anio-select"
                      className="select-control"
                      value={selectedBalanceAnio}
                      style={{ height: '30px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                      onChange={(e) => setSelectedBalanceAnio(e.target.value)}
                      disabled={uniqueBalanceAnios.length === 0}
                    >
                      {uniqueBalanceAnios.map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>

                </section>

                {/* Gráfico de Balance Hídrico Mensual */}
                {selectedBalanceAnio && (
                  <section className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', width: '100%' }}>
                      <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.9rem', margin: 0, color: 'var(--text-main)', letterSpacing: '0.02em' }}>
                        GRÁFICO: BALANCE HÍDRICO MENSUAL — {FINCA_NAMES[selectedBalanceFinca] || selectedBalanceFinca} ({selectedBalanceAnio})
                      </h4>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {/* Botón discreto de achurado (solo símbolo) */}
                        <button
                          onClick={() => setShowHatching(!showHatching)}
                          style={{
                            background: showHatching ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                            border: showHatching ? '1px solid rgba(0, 242, 254, 0.3)' : '1px solid var(--border-light)',
                            borderRadius: '4px',
                            padding: '0',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s ease',
                            outline: 'none',
                            height: '24px',
                            width: '28px'
                          }}
                          title={showHatching ? "Desactivar achurado de áreas" : "Activar achurado de áreas"}
                        >
                          <div style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '2px',
                            background: showHatching 
                              ? 'repeating-linear-gradient(45deg, #00f2fe, #00f2fe 1px, transparent 1px, transparent 3px)'
                              : 'repeating-linear-gradient(45deg, var(--text-muted), var(--text-muted) 1px, transparent 1px, transparent 3px)',
                            opacity: 0.8
                          }} />
                        </button>

                        <button
                          onClick={() => handleDownloadChart(balanceChartRef, `balance_hidrico_${selectedBalanceFinca}_${selectedBalanceAnio}`)}
                          disabled={!selectedBalanceAnio}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            fontSize: '0.7rem',
                            cursor: !selectedBalanceAnio ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: !selectedBalanceAnio ? 0.3 : 0.5,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            transition: 'opacity 0.2s, background 0.2s',
                            outline: 'none'
                          }}
                          onMouseEnter={(e) => { if (selectedBalanceAnio) { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; } }}
                          onMouseLeave={(e) => { if (selectedBalanceAnio) { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.background = 'transparent'; } }}
                          title="Descargar gráfico como PNG"
                        >
                          <Download size={11} />
                          Descargar
                        </button>
                      </div>
                    </div>
                    <div style={{ height: '220px', position: 'relative', width: '100%' }}>
                      <Chart key={`balance_chart_${balanceChartType}_${showHatching}`} ref={balanceChartRef} type={balanceChartType} data={balanceChartData} options={balanceChartOptions} plugins={[customDataLabelsPlugin]} />
                    </div>
                  </section>
                )}

                {/* Tabla resumen: Precipitación, ET y Déficit/Exceso */}
                {(() => {
                  const MES_ABREV  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
                  const selectedYearInt = parseInt(selectedBalanceAnio, 10) || new Date().getFullYear();
                  
                  // días por mes ajustado por bisiesto
                  const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
                  if (selectedYearInt % 4 === 0 && (selectedYearInt % 100 !== 0 || selectedYearInt % 400 === 0)) {
                    DAYS_PER_MONTH[1] = 29;
                  }

                  // Obtener datos del año seleccionado
                  const selectedYearData = balanceTableData.find(row => row.year === selectedYearInt);
                  const precipData = selectedYearData ? selectedYearData.months : Array.from({ length: 12 }, () => 0);

                  // Evapotranspiración mensual = ET diaria × días del mes
                  const etMonthly = DAYS_PER_MONTH.map(d => etcEfectiva * d);

                  // Déficit / Exceso
                  const deficit = precipData.map((p, i) => p - etMonthly[i]);

                  // Determinar el último año y mes con datos en la base para esta finca/pluviómetro
                  let dbMaxYear = 0;
                  let dbMaxMonth = 0;
                  let filteredFinca = records.filter(r => r.finca === selectedBalanceFinca);
                  if (selectedBalancePluviometro && selectedBalancePluviometro !== 'Todos') {
                    filteredFinca = filteredFinca.filter(r => r.pluviometro === selectedBalancePluviometro);
                  }
                  filteredFinca.forEach(r => {
                    if (r.anio > dbMaxYear) {
                      dbMaxYear = r.anio;
                      dbMaxMonth = r.mes;
                    } else if (r.anio === dbMaxYear) {
                      if (r.mes > dbMaxMonth) {
                        dbMaxMonth = r.mes;
                      }
                    }
                  });

                  let maxActiveMonth = 0;
                  if (selectedYearInt < dbMaxYear) {
                    maxActiveMonth = 12;
                  } else if (selectedYearInt === dbMaxYear) {
                    maxActiveMonth = dbMaxMonth;
                  }

                  // Crear un Set con los meses activos (1 a maxActiveMonth)
                  const activeMonths = new Set(
                    Array.from({ length: maxActiveMonth }, (_, i) => i + 1)
                  );

                  const cellBase = {
                    padding: '0.22rem 0.3rem',
                    border: '1px solid var(--border-light)',
                    textAlign: 'center',
                    fontSize: '0.72rem',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)',
                    cursor: 'default'
                  };

                  return (
                    <div className="glass-panel matrix-panel" style={{ padding: '1rem 1.25rem', marginTop: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          {FINCA_NAMES[selectedBalanceFinca] || selectedBalanceFinca} — Balance Hídrico Mensual ({selectedYearInt})
                        </span>
                        <button
                          onClick={() => handleDownloadBalanceMensual(precipData, etMonthly, selectedYearInt, FINCA_NAMES[selectedBalanceFinca] || selectedBalanceFinca, selectedBalancePluviometro)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: 0.5,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            transition: 'opacity 0.2s, background 0.2s',
                            outline: 'none'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.background = 'transparent'; }}
                          title="Descargar balance mensual como Excel"
                        >
                          <Download size={11} />
                          Descargar
                        </button>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', color: 'var(--text-main)', fontFamily: 'var(--font-main)' }}>
                          <thead>
                            <tr>
                              {/* Columna de etiqueta */}
                              <th style={{ ...cellBase, textAlign: 'left', minWidth: '160px', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '2px solid var(--border-light)', background: 'transparent', fontSize: '0.68rem' }}></th>
                              {MES_ABREV.map(m => (
                                <th key={m} style={{ ...cellBase, borderBottom: '2px solid var(--border-light)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.68rem', minWidth: '52px', background: 'transparent' }}>{m}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* Fila 1: Precipitación efectiva */}
                            <tr>
                              <td style={{ ...cellBase, textAlign: 'left', fontWeight: 700, color: 'var(--text-main)', background: 'rgba(255,255,255,0.02)', paddingLeft: '0.5rem' }}>
                                Precipitación Efectiva
                              </td>
                              {precipData.map((val, i) => {
                                const isActive = activeMonths.has(i + 1);
                                return (
                                  <td
                                    key={i}
                                    className="matrix-cell"
                                    title={isActive ? `${MES_ABREV[i]}: ${val.toFixed(1)} mm` : `Sin datos en ${MES_ABREV[i]}`}
                                    style={{
                                      ...cellBase,
                                      background: isActive && val > 0 ? 'rgba(0,242,254,0.12)' : 'transparent',
                                      color: isActive && val > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                                      fontWeight: isActive && val > 0 ? 600 : 400,
                                      opacity: isActive ? 1 : 0.25,
                                      border: isActive && val > 0 ? '1px solid rgba(0,242,254,0.35)' : '1px solid var(--border-light)'
                                    }}
                                  >
                                    {isActive ? (val > 0 ? val.toFixed(1) : '0') : '-'}
                                  </td>
                                );
                              })}
                            </tr>

                            {/* Fila 2: Evapotranspiración */}
                            <tr>
                              <td style={{ ...cellBase, textAlign: 'left', fontWeight: 700, color: 'var(--text-main)', background: 'rgba(255,255,255,0.02)', paddingLeft: '0.5rem' }}>
                                Evapotranspiración
                              </td>
                              {etMonthly.map((val, i) => {
                                const isActive = activeMonths.has(i + 1);
                                return (
                                  <td
                                    key={i}
                                    className="matrix-cell"
                                    title={isActive ? `ET ${MES_ABREV[i]}: ${val.toFixed(1)} mm (ET configurada × ${DAYS_PER_MONTH[i]} días)` : `Sin datos en ${MES_ABREV[i]}`}
                                    style={{
                                      ...cellBase,
                                      background: isActive ? 'rgba(253,203,110,0.08)' : 'transparent',
                                      color: isActive ? '#fdc96e' : 'rgba(255,255,255,0.12)',
                                      fontWeight: isActive ? 600 : 400,
                                      opacity: isActive ? 1 : 0.25,
                                      border: isActive ? '1px solid rgba(253,203,110,0.25)' : '1px solid var(--border-light)'
                                    }}
                                  >
                                    {isActive ? val.toFixed(1) : '-'}
                                  </td>
                                );
                              })}
                            </tr>

                            {/* Fila 3: Déficit / Exceso */}
                            <tr>
                              <td style={{ ...cellBase, textAlign: 'left', fontWeight: 700, color: 'var(--text-main)', background: 'rgba(255,255,255,0.02)', paddingLeft: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                  <span>Déficit / Exceso</span>
                                  <button
                                    onClick={() => setInvertDeficitSign(!invertDeficitSign)}
                                    style={{
                                      padding: '1px 5px',
                                      fontSize: '0.65rem',
                                      fontFamily: 'var(--font-display)',
                                      fontWeight: 700,
                                      borderRadius: '3px',
                                      border: invertDeficitSign ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid var(--border-light)',
                                      background: invertDeficitSign ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                                      color: invertDeficitSign ? '#00f2fe' : 'var(--text-muted)',
                                      cursor: 'pointer',
                                      transition: 'all 0.2s ease',
                                      lineHeight: '1',
                                      outline: 'none',
                                      boxShadow: invertDeficitSign ? '0 0 6px rgba(0, 242, 254, 0.2)' : 'none'
                                    }}
                                    title={invertDeficitSign ? "Mostrar signo original" : "Multiplicar negativos por -1"}
                                  >
                                    -1
                                  </button>
                                </div>
                              </td>
                              {deficit.map((val, i) => {
                                const isActive = activeMonths.has(i + 1);
                                const isDeficit = val < 0;
                                return (
                                  <td
                                    key={i}
                                    className="matrix-cell"
                                    title={isActive ? `${isDeficit ? 'Déficit' : 'Exceso'} ${MES_ABREV[i]}: ${val.toFixed(1)} mm` : `Sin datos en ${MES_ABREV[i]}`}
                                    style={{
                                      ...cellBase,
                                      background: isActive ? (isDeficit ? 'rgba(255,75,75,0.14)' : 'rgba(52,211,153,0.12)') : 'transparent',
                                      color: isActive ? (isDeficit ? '#ff6b6b' : '#34d399') : 'rgba(255,255,255,0.12)',
                                      fontWeight: isActive ? 700 : 400,
                                      opacity: isActive ? 1 : 0.25,
                                      border: isActive ? (isDeficit ? '1px solid rgba(255,75,75,0.35)' : '1px solid rgba(52,211,153,0.35)') : '1px solid var(--border-light)'
                                    }}
                                  >
                                    {isActive ? (isDeficit && invertDeficitSign ? Math.abs(val).toFixed(1) : val.toFixed(1)) : '-'}
                                  </td>
                                );
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* SECCIÓN 2 — CURVA DE RESERVA DEL SUELO + SEMÁFORO DE ESTRÉS */}
                {selectedBalanceAnio && reservaCurveData && (
                  <section id="balance-reserva-suelo-seccion" className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', width: '100%' }}>
                      <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.95rem', margin: 0, color: 'var(--text-main)', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Droplet size={14} className="text-accent" />
                        RESERVA DEL SUELO Y ESTADO DE ESTRÉS HÍDRICO ({selectedBalanceAnio})
                      </h4>
                      <button
                        onClick={() => handleDownloadFullPanel('balance-reserva-suelo-seccion', `reserva_suelo_completo_${selectedBalanceFinca}_${selectedBalanceAnio}`)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          opacity: 0.6,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          transition: 'opacity 0.2s, background 0.2s',
                          outline: 'none'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.6; e.currentTarget.style.background = 'transparent'; }}
                        title="Descargar gráfico como PNG"
                      >
                        <Download size={11} />
                        Descargar Gráfico
                      </button>
                    </div>

                    {/* Explicación en lenguaje cotidiano */}
                    <div style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-main)',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-light)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '-0.25rem'
                    }}>
                      <Info size={14} className="text-accent" style={{ flexShrink: 0 }} />
                      <span>
                        <strong>¿Qué significa esto?</strong> Mide la cantidad de agua que el suelo tiene guardada para las plantas (en milímetros y porcentaje de su capacidad máxima). El concepto CAD corresponde a la <strong>Capacidad de Agua Disponible (CAD)</strong>, que representa la cantidad total de agua que el suelo puede retener y entregar a las raíces de las plantas. Una reserva menor al 10% de la CAD indica que la tierra está críticamente seca (estrés severo).
                      </span>
                    </div>

                    {/* Semáforos de Estrés Hídrico */}
                    <div style={{ display: 'flex', gap: '1rem', width: '100%', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {ESTRES_NIVELES.map(nivel => {
                        const count = reservaCurveData.conteoNiveles[nivel.label] || 0;
                        const matchingMonths = reservaCurveData.meses
                          .filter(m => m.nivel.label === nivel.label)
                          .map(m => MONTH_NAMES_LONG[m.mes + 1])
                          .join(', ');
                        
                        const percentRange = nivel.pctMin === 60 
                          ? '> 60% Capacidad de Agua Disponible (CAD)' 
                          : nivel.pctMin === 30 
                            ? '30 – 60% Capacidad de Agua Disponible (CAD)' 
                            : nivel.pctMin === 10 
                              ? '10 – 30% Capacidad de Agua Disponible (CAD)' 
                              : '< 10% Capacidad de Agua Disponible (CAD)';

                        return (
                          <div 
                            key={nivel.label}
                            className="glass-panel"
                            title={count > 0 ? `Meses en este estado: ${matchingMonths}` : 'Sin meses en este estado'}
                            style={{
                              flex: '1 1 200px',
                              padding: '0.75rem 1rem',
                              background: count > 0 ? nivel.colorAlpha : 'rgba(255, 255, 255, 0.02)',
                              borderColor: count > 0 ? nivel.color : 'var(--border-light)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.2rem',
                              transition: 'all 0.2s ease',
                              borderLeft: count > 0 ? `4px solid ${nivel.color}` : '4px solid rgba(255, 255, 255, 0.15)'
                            }}
                          >
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>{nivel.icon}</span> {nivel.label}
                            </span>
                            <span style={{ fontSize: '1.6rem', fontWeight: 700, color: count > 0 ? nivel.color : 'var(--text-muted)' }}>
                              {count} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>meses</span>
                              {count > 0 && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'rgba(255, 255, 255, 0.45)', marginLeft: '6px', fontStyle: 'italic', display: 'inline-block' }}>
                                  ({reservaCurveData.meses
                                    .filter(m => m.nivel.label === nivel.label)
                                    .map(m => ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][m.mes])
                                    .join(', ')})
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                              Rango: {percentRange}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Gráfico de Área */}
                    <div style={{ height: '260px', position: 'relative', width: '100%' }}>
                      <Chart 
                        key={`reserva_chart_${selectedBalanceAnio}_${capacidadSuelo}`}
                        ref={reservaChartRef} 
                        type="line" 
                        plugins={[backgroundZonesPlugin]}
                        data={{
                          labels: ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"],
                          datasets: [
                            {
                              type: 'line',
                              label: 'Reserva del Suelo (mm)',
                              data: reservaCurveData.meses.map(m => m.reserva),
                              borderColor: '#00f2fe',
                              borderWidth: 2.5,
                              tension: 0.4,
                              fill: 'origin',
                              backgroundColor: 'rgba(0, 242, 254, 0.08)',
                              pointBackgroundColor: reservaCurveData.meses.map(m => m.nivel.color),
                              pointBorderColor: reservaCurveData.meses.map(m => m.nivel.color),
                              pointRadius: 6,
                              pointHoverRadius: 8
                            },
                            {
                              type: 'line',
                              label: 'Límite Óptimo (60%)',
                              data: Array(12).fill(capacidadSuelo * 0.60),
                              borderColor: '#00c853',
                              borderDash: [5, 5],
                              borderWidth: 1.5,
                              pointRadius: 0,
                              fill: false
                            },
                            {
                              type: 'line',
                              label: 'Límite Atención (30%)',
                              data: Array(12).fill(capacidadSuelo * 0.30),
                              borderColor: '#ffd600',
                              borderDash: [5, 5],
                              borderWidth: 1.5,
                              pointRadius: 0,
                              fill: false
                            },
                            {
                              type: 'line',
                              label: 'Límite Estrés (10%)',
                              data: Array(12).fill(capacidadSuelo * 0.10),
                              borderColor: '#ff4b4b',
                              borderDash: [5, 5],
                              borderWidth: 1.5,
                              pointRadius: 0,
                              fill: false
                            }
                          ]
                        }} 
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: 'bottom',
                              labels: {
                                usePointStyle: true,
                                boxWidth: 8,
                                boxHeight: 8,
                                color: 'rgba(255, 255, 255, 0.8)',
                                font: { family: 'Outfit, sans-serif', size: 11 },
                                generateLabels(chart) {
                                  const original = ChartJS.defaults.plugins.legend.labels.generateLabels(chart);
                                  return original.map(label => {
                                    if (label.text === 'Reserva del Suelo (mm)') {
                                      label.fillStyle = '#00f2fe';
                                      label.strokeStyle = '#00f2fe';
                                    }
                                    return label;
                                  });
                                }
                              }
                            },
                            tooltip: {
                              backgroundColor: 'rgba(10, 15, 30, 0.95)',
                              titleColor: '#ffffff',
                              bodyColor: '#ffffff',
                              borderColor: 'rgba(255, 255, 255, 0.1)',
                              borderWidth: 1,
                              padding: 10,
                              cornerRadius: 6,
                              callbacks: {
                                label: (context) => {
                                  const idx = context.dataIndex;
                                  const mData = reservaCurveData.meses[idx];
                                  if (!mData) return '';
                                  return [
                                    `Reserva: ${mData.reserva.toFixed(1)} mm (${mData.pct.toFixed(1)}% Capacidad de Agua Disponible)`,
                                    `Estado: ${mData.nivel.icon} ${mData.nivel.label}`,
                                    `Precipitación: ${mData.prec.toFixed(1)} mm | ETc: ${mData.etcMes.toFixed(1)} mm | Balance: ${mData.balance.toFixed(1)} mm`
                                  ];
                                }
                              }
                            }
                          },
                          scales: {
                            x: {
                              grid: { color: 'rgba(255, 255, 255, 0.05)' },
                              ticks: { color: 'rgba(255, 255, 255, 0.6)', font: { family: 'Inter, sans-serif', size: 10 } }
                            },
                            y: {
                              min: 0,
                              max: capacidadSuelo,
                              grace: '5%',
                              title: {
                                display: true,
                                text: 'Reserva del Suelo (mm)',
                                color: 'rgba(255, 255, 255, 0.8)',
                                font: { family: 'Outfit, sans-serif', size: 11, weight: 'bold' }
                              },
                              grid: { color: 'rgba(255, 255, 255, 0.05)' },
                              ticks: { color: 'rgba(255, 255, 255, 0.6)', font: { family: 'Inter, sans-serif', size: 10 } }
                            },
                            y1: {
                              type: 'linear',
                              display: true,
                              position: 'right',
                              min: 0,
                              max: 100,
                              grid: {
                                drawOnChartArea: false,
                              },
                              ticks: {
                                color: 'rgba(255, 255, 255, 0.5)',
                                font: { family: 'Inter, sans-serif', size: 9 },
                                callback: (value) => `${value}%`
                              },
                              title: {
                                display: true,
                                text: '% Capacidad de Agua Disponible',
                                color: 'rgba(255, 255, 255, 0.6)',
                                font: { family: 'Outfit, sans-serif', size: 10, weight: 'bold' }
                              }
                            }
                          }
                        }}
                      />
                    </div>
                  </section>
                )}

                {/* SECCIÓN 3 — PANEL SPI (ESTADO CLIMÁTICO) */}
                {selectedBalanceAnio && spiData && (
                  <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', width: '100%' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.95rem', margin: 0, color: 'var(--text-main)', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Calendar size={14} className="text-accent" />
                            ANÁLISIS CLIMÁTICO HISTÓRICO Y MENSUAL (ÍNDICE SPI)
                          </h4>
                          
                          {/* Botón de ayuda interactiva con estado hover/click */}
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              onMouseEnter={() => setShowSpiHelp(true)}
                              onMouseLeave={() => setShowSpiHelp(false)}
                              onClick={() => setShowSpiHelp(!showSpiHelp)}
                              style={{
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '18px',
                                height: '18px',
                                borderRadius: '50%',
                                background: 'rgba(0, 242, 254, 0.1)',
                                color: '#00f2fe',
                                fontSize: '0.7rem',
                                fontWeight: 'bold',
                                border: '1px solid rgba(0, 242, 254, 0.25)',
                                outline: 'none',
                                transition: 'all 0.2s ease'
                              }}
                              title="Haz clic o pasa el cursor para ver la guía rápida del índice SPI"
                            >
                              ?
                            </button>
                            
                            {showSpiHelp && (
                              <div style={{
                                position: 'absolute',
                                top: '26px',
                                left: '0',
                                width: '460px',
                                background: 'rgba(15, 23, 42, 0.99)',
                                border: '1px solid var(--border-light)',
                                borderRadius: '8px',
                                padding: '1rem',
                                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.75)',
                                zIndex: 9999,
                                color: 'var(--text-main)',
                                fontSize: '0.72rem',
                                lineHeight: '1.45',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.75rem'
                              }}>
                                <span style={{ color: '#00f2fe', fontWeight: 600, display: 'block', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                                  💡 Guía del Índice SPI (Climatología Simplificada)
                                </span>
                                
                                <div>
                                  <strong>¿Qué significan las siglas SPI?</strong><br />
                                  Corresponde al <strong>Índice de Precipitación Estandarizado</strong>. Es la escala mundial usada para medir anomalías de lluvia. Compara el agua caída en un periodo con la historia de la zona para indicar si el clima está más seco (sequía) o húmedo (exceso) de lo habitual.
                                </div>

                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                                  <strong>¿Cómo entender los periodos (Trimestral vs Anual)?</strong>
                                  <ul style={{ margin: '4px 0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <li>
                                      <strong>SPI-3 (Trimestral - Tendencia Estacional):</strong> Mide bloques acumulados de 3 meses.
                                      <br /><span style={{ color: 'var(--text-muted)' }}><em>Ejemplo del Gráfico:</em> La barra de <strong>Marzo</strong> no representa solo ese mes, sino la suma de <strong>Enero, Febrero y Marzo</strong>. Si la barra apunta hacia abajo (amarilla/naranja), significa que ese trimestre fue seco para esa época, afectando la humedad del suelo agrícola actual.</span>
                                    </li>
                                    <li>
                                      <strong>SPI-12 (Anual - Tendencia de Reservas):</strong> Evalúa los últimos 12 meses. Ayuda a identificar sequías graves y prolongadas que impactan en pozos, ríos y acuíferos profundos.
                                    </li>
                                  </ul>
                                </div>

                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                                  <strong>Escala de Valores (¿Cómo interpretar los números?):</strong>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '4px', fontSize: '0.7rem' }}>
                                    <div style={{ background: 'rgba(0, 180, 216, 0.08)', padding: '5px 8px', borderRadius: '4px', borderLeft: '3px solid #00b4d8' }}>
                                      <span style={{ color: '#00b4d8', fontWeight: 'bold' }}>Valores Positivos (&gt; 0)</span><br />
                                      • <strong>+1.0 a +1.5:</strong> Moderadamente Húmedo<br />
                                      • <strong>+1.5 a +2.0:</strong> Muy Húmedo<br />
                                      • <strong>&gt; +2.0:</strong> Exceso Extremo / Inundación
                                    </div>
                                    <div style={{ background: 'rgba(244, 132, 95, 0.08)', padding: '5px 8px', borderRadius: '4px', borderLeft: '3px solid #f4845f' }}>
                                      <span style={{ color: '#f4845f', fontWeight: 'bold' }}>Valores Negativos (&lt; 0)</span><br />
                                      • <strong>-1.0 a -1.5:</strong> Sequía Moderada<br />
                                      • <strong>-1.5 a -2.0:</strong> Sequía Severa<br />
                                      • <strong>&lt; -2.0:</strong> Sequía Extrema / Crítica
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'center', color: '#ffd600', marginTop: '6px', fontSize: '0.65rem', fontWeight: 500 }}>
                                    * Los valores entre <strong>-1.0 y +1.0</strong> indican un clima <strong>Normal / Promedio</strong>.
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Compara cada trimestre con el promedio histórico de la misma época
                        </span>
                      </div>
                    </div>

                    {spiData.insuficiente ? (
                      <div className="glass-panel" style={{ padding: '1rem', borderColor: 'var(--warning)', background: 'rgba(255, 214, 0, 0.03)', display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginTop: '0.5rem' }}>
                        <AlertTriangle className="text-warning" size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div>
                          <p style={{ fontWeight: 600, color: 'var(--text-main)', margin: '0 0 0.25rem 0', fontSize: '0.85rem' }}>Datos históricos insuficientes para el SPI</p>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0, lineHeight: 1.4 }}>
                            El índice SPI necesita mínimo 5 años de registros históricos para ser confiable. 
                            Actualmente hay {spiData.añosDisponibles} año(s) disponibles. 
                            Continúa cargando datos de años anteriores para activar este indicador.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginTop: '0.5rem' }}>
                          {/* Tarjeta de Diagnóstico Anual */}
                          {spiData.añoActual && (
                            <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
                              <h5 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>Estado de Sequía / Humedad del Año {selectedBalanceAnio}</h5>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1rem', alignItems: 'center' }}>
                                {/* Columna izquierda */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                  <span style={{ fontSize: '2.8rem', fontWeight: 700, color: spiData.añoActual.categoria.color, lineHeight: 1 }}>
                                    {spiData.añoActual.spi12.toFixed(2) === '-0.00' ? '0.00' : spiData.añoActual.spi12.toFixed(2)}
                                  </span>
                                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    {spiData.añoActual.categoria.icon} {spiData.añoActual.categoria.label}
                                  </span>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '4px' }}>
                                    <span>Lluvia año: {spiData.añoActual.precAnual.toLocaleString('es-ES', { maximumFractionDigits: 1 })} mm</span>
                                    <span>Histórico: {spiData.añoActual.media.toLocaleString('es-ES', { maximumFractionDigits: 1 })} mm</span>
                                    <span style={{ color: spiData.añoActual.diferencia >= 0 ? '#00c853' : '#ff4b4b' }}>
                                      Dif: {spiData.añoActual.diferencia >= 0 ? '+' : ''}{spiData.añoActual.diferencia.toLocaleString('es-ES', { maximumFractionDigits: 1 })} mm ({spiData.añoActual.diferencia >= 0 ? '+' : ''}{spiData.añoActual.pct.toFixed(1)}%)
                                    </span>
                                  </div>
                                </div>

                                {/* Columna derecha */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignSelf: 'center' }}>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Posición en escala histórica</span>
                                  
                                  {/* Gradiente */}
                                  <div style={{ position: 'relative', width: '100%', height: '10px', borderRadius: '5px', background: 'linear-gradient(to right, #e63946, #f4845f, #ffd166, #52b788, #90e0ef, #48cae4, #00b4d8)' }}>
                                    {/* Marcador */}
                                    <div style={{
                                      position: 'absolute',
                                      left: `${Math.max(0, Math.min(100, ((spiData.añoActual.spi12 + 3) / 6) * 100))}%`,
                                      top: '-2px',
                                      width: '3px',
                                      height: '14px',
                                      background: '#ffffff',
                                      boxShadow: '0 0 4px rgba(0,0,0,0.6)',
                                      borderRadius: '1px'
                                    }} />
                                  </div>
                                  
                                  {/* Escala */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600, padding: '0 2px' }}>
                                    <span>-3</span>
                                    <span>-2</span>
                                    <span>-1</span>
                                    <span>0</span>
                                    <span>+1</span>
                                    <span>+2</span>
                                    <span>+3</span>
                                  </div>

                                  {/* Etiquetas textuales de impacto */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: 'rgba(255, 255, 255, 0.45)', marginTop: '2px', fontWeight: 500 }}>
                                    <span style={{ flex: 1, textAlign: 'left' }}>◀ Sequía Extrema</span>
                                    <span style={{ flex: 1, textAlign: 'center' }}>Promedio Normal</span>
                                    <span style={{ flex: 1, textAlign: 'right' }}>Exceso / Inundación ▶</span>
                                  </div>
                                </div>
                             </div>
                           </div>
                           )}

                          {/* Gráfico SPI-3 Mensual */}
                          <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <h5 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>Comportamiento de Lluvias por Época (Tendencia de 3 meses)</h5>
                            <div style={{ height: '180px', position: 'relative', width: '100%' }}>
                              <Chart 
                                key={`spi_chart_${selectedBalanceAnio}`}
                                ref={spiChartRef} 
                                type="bar" 
                                plugins={[horizontalLinePlugin]}
                                data={{
                                  labels: ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"],
                                  datasets: [
                                    {
                                      type: 'bar',
                                      label: 'SPI-3 Mensual',
                                      data: spiData.mensual.map(m => m.spi3),
                                      backgroundColor: spiData.mensual.map(m => 
                                        m.spi3 >= 0 
                                          ? 'rgba(0, 180, 216, 0.65)' 
                                          : m.spi3 <= -1.0 
                                            ? 'rgba(244, 132, 95, 0.7)' 
                                            : 'rgba(255, 209, 102, 0.7)'
                                      ),
                                      borderColor: spiData.mensual.map(m => 
                                        m.spi3 >= 0 
                                          ? '#00b4d8' 
                                          : m.spi3 <= -1.0 
                                            ? '#f4845f' 
                                            : '#ffd166'
                                      ),
                                      borderWidth: 1.5,
                                      borderRadius: 4,
                                      order: 1
                                    },
                                    {
                                      type: 'line',
                                      label: 'Límite Húmedo (+1.0)',
                                      data: Array(12).fill(1.0),
                                      borderColor: 'rgba(255, 255, 255, 0.15)',
                                      borderDash: [4, 4],
                                      borderWidth: 1,
                                      pointRadius: 0,
                                      fill: false,
                                      order: 2
                                    },
                                    {
                                      type: 'line',
                                      label: 'Límite Seco (-1.0)',
                                      data: Array(12).fill(-1.0),
                                      borderColor: 'rgba(255, 255, 255, 0.15)',
                                      borderDash: [4, 4],
                                      borderWidth: 1,
                                      pointRadius: 0,
                                      fill: false,
                                      order: 3
                                    }
                                  ]
                                }} 
                                options={{
                                  responsive: true,
                                  maintainAspectRatio: false,
                                  plugins: {
                                    legend: { display: false },
                                    tooltip: {
                                      backgroundColor: 'rgba(10, 15, 30, 0.95)',
                                      titleColor: '#ffffff',
                                      bodyColor: '#ffffff',
                                      borderColor: 'rgba(255, 255, 255, 0.1)',
                                      borderWidth: 1,
                                      padding: 10,
                                      cornerRadius: 6,
                                      callbacks: {
                                        label: (context) => {
                                          const idx = context.dataIndex;
                                          const mData = spiData.mensual[idx];
                                          if (!mData) return '';
                                          const valStr = mData.spi3.toFixed(2) === '-0.00' ? '0.00' : mData.spi3.toFixed(2);
                                          return [
                                            `Tendencia (SPI-3): ${valStr} (${mData.categoria.icon} ${mData.categoria.label})`,
                                            `Lluvia en el trimestre: ${mData.prec3meses.toFixed(1)} mm`,
                                            `Promedio histórico trimestre: ${mData.media3meses.toFixed(1)} mm`
                                          ];
                                        }
                                      }
                                    },
                                    horizontalLine: {
                                      yValue: 0,
                                      borderColor: 'rgba(255, 255, 255, 0.25)',
                                      borderWidth: 1.5
                                    }
                                  },
                                  scales: {
                                    x: {
                                      grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                      ticks: { color: 'rgba(255, 255, 255, 0.6)', font: { family: 'Inter, sans-serif', size: 10 } }
                                    },
                                    y: {
                                      min: -3,
                                      max: 3,
                                      grace: '10%',
                                      title: {
                                        display: true,
                                        text: 'Desviación de Lluvias (Escala SPI)',
                                        color: 'rgba(255, 255, 255, 0.8)',
                                        font: { family: 'Outfit, sans-serif', size: 10, weight: 'bold' }
                                      },
                                      grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                      ticks: {
                                        color: 'rgba(255, 255, 255, 0.6)',
                                        font: { family: 'Inter, sans-serif', size: 9 },
                                        callback: (value) => {
                                          if (value === 0) return 'Promedio Histórico';
                                          if (value === 1.5) return 'Más Húmedo';
                                          if (value === 3) return 'Húmedo Extremo';
                                          if (value === -1.5) return 'Más Seco';
                                          if (value === -3) return 'Seco Extremo';
                                          return '';
                                        }
                                      }
                                    }
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Tabla Histórica por Año */}
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Historial Anual Clasificado</span>
                            <button
                              onClick={handleDownloadSpiExcel}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--accent)',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                transition: 'all 0.2s ease',
                                outline: 'none'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 242, 254, 0.05)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <Download size={12} />
                              Exportar Historial
                            </button>
                          </div>
                          
                          <div style={{ maxHeight: '200px', overflowY: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', background: 'rgba(0,0,0,0.2)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                                  <th style={{ padding: '0.4rem 0.75rem' }}>Año</th>
                                  <th style={{ padding: '0.4rem 0.75rem' }}>Lluvia Total (mm)</th>
                                  <th style={{ padding: '0.4rem 0.75rem' }}>Diferencia vs Promedio</th>
                                  <th style={{ padding: '0.4rem 0.75rem' }}>SPI-12</th>
                                  <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>Clasificación</th>
                                </tr>
                              </thead>
                              <tbody>
                                {spiData.tablaAnual.map((row) => {
                                  const isSelYear = row.year === parseInt(selectedBalanceAnio, 10);
                                  const isCurrentYear = row.year === new Date().getFullYear();
                                  return (
                                    <tr 
                                      key={row.year}
                                      style={{
                                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                                        transition: 'all 0.15s ease',
                                        background: isSelYear ? 'rgba(0, 242, 254, 0.05)' : hexToRgba(row.categoria.color, 0.04),
                                        color: isSelYear ? 'var(--accent)' : 'var(--text-main)',
                                        borderLeft: isSelYear ? '3px solid var(--accent)' : '3px solid transparent',
                                        fontWeight: isSelYear ? 600 : 'normal'
                                      }}
                                    >
                                      <td style={{ padding: '0.4rem 0.75rem' }}>
                                        {row.year} {isCurrentYear && <span style={{ fontSize: '0.65rem', opacity: 0.8, color: '#ffd600', fontWeight: 600 }}>(En curso *)</span>}
                                      </td>
                                      <td style={{ padding: '0.4rem 0.75rem' }}>
                                        {row.precAnual.toLocaleString('es-ES', { maximumFractionDigits: 1 })} mm
                                      </td>
                                      <td style={{ padding: '0.4rem 0.75rem', color: row.diferencia >= 0 ? '#00c853' : '#ff4b4b' }}>
                                        {row.diferencia >= 0 ? '+' : ''}{row.diferencia.toLocaleString('es-ES', { maximumFractionDigits: 1 })} mm ({row.diferencia >= 0 ? '+' : ''}{row.pct.toFixed(1)}%)
                                      </td>
                                      <td style={{ padding: '0.4rem 0.75rem', fontWeight: 600, color: row.categoria.color }}>
                                        {row.spi12.toFixed(2) === '-0.00' ? '0.00' : row.spi12.toFixed(2)}
                                      </td>
                                      <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600, color: row.categoria.color }}>
                                        {row.categoria.icon} {row.categoria.label}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Info size={10} className="text-accent" style={{ flexShrink: 0 }} />
                            <span>* Nota: El año {new Date().getFullYear()} está en curso. La precipitación total y el índice SPI se muestran acumulados a la fecha actual y no corresponden a un año climatológico completo.</span>
                          </div>
                        </div>
                      </>
                    )}
                  </section>
                )}



                {/* Tabla de Consolidado */}

                <div className="glass-panel matrix-panel" style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {FINCA_NAMES[selectedBalanceFinca] || selectedBalanceFinca}
                      {selectedBalancePluviometro && selectedBalancePluviometro !== 'Todos' ? ` · ${selectedBalancePluviometro}` : ''} — Consolidado Anual
                    </span>
                    <button
                      onClick={handleDownloadBalanceExcel}
                      disabled={balanceTableData.length === 0}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '0.7rem',
                        cursor: balanceTableData.length === 0 ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: balanceTableData.length === 0 ? 0.25 : 0.5,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        transition: 'opacity 0.2s, background 0.2s',
                        outline: 'none'
                      }}
                      onMouseEnter={(e) => { if (balanceTableData.length > 0) { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = balanceTableData.length === 0 ? '0.25' : '0.5'; e.currentTarget.style.background = 'transparent'; }}
                      title="Descargar consolidado en Excel"
                    >
                      <Download size={11} />
                      Descargar Excel
                    </button>
                  </div>
                  {(() => {
                    const FIXED_ROWS = 12;
                    const dataRows = balanceTableData;
                    const emptyCount = Math.max(0, FIXED_ROWS - dataRows.length);
                    return (
                      <div className="excel-table-container">
                        <table className="excel-table">
                          <thead>
                            <tr>
                              <th className="cell-month-header" style={{ textAlign: 'left' }}>Año</th>
                              <th className="cell-month-header">Ene</th>
                              <th className="cell-month-header">Feb</th>
                              <th className="cell-month-header">Mar</th>
                              <th className="cell-month-header">Abr</th>
                              <th className="cell-month-header">May</th>
                              <th className="cell-month-header">Jun</th>
                              <th className="cell-month-header">Jul</th>
                              <th className="cell-month-header">Ago</th>
                              <th className="cell-month-header">Sep</th>
                              <th className="cell-month-header">Oct</th>
                              <th className="cell-month-header">Nov</th>
                              <th className="cell-month-header">Dic</th>
                              <th className="cell-month-header" style={{ borderLeft: '2px solid var(--border-light)', color: 'var(--primary)' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const MES_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
                              return dataRows.map(row => (
                                <tr key={row.year}>
                                  <td className="cell-year">{row.year}</td>
                                  {row.months.map((mVal, mIdx) => (
                                    <td
                                      key={mIdx}
                                      className={`matrix-cell ${mVal > 0 ? 'cell-value-positive' : 'cell-value-zero'}`}
                                      title={`${MES_NAMES[mIdx]} ${row.year}: ${mVal.toFixed(1)} mm`}
                                    >
                                      {mVal > 0 ? mVal.toFixed(1) : '0'}
                                    </td>
                                  ))}
                                  <td className="cell-total matrix-cell" title={`Total ${row.year}: ${row.total.toFixed(1)} mm`}>{row.total.toFixed(1)}</td>
                                </tr>
                              ));
                            })()}
                            {Array.from({ length: emptyCount }).map((_, i) => (
                              <tr key={`empty-${i}`} style={{ opacity: 0 }} aria-hidden="true">
                                <td className="cell-year">&nbsp;</td>
                                {Array.from({ length: 13 }).map((__, j) => (
                                  <td key={j} className="cell-value-zero">&nbsp;</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        )}
        </div> {/* closes tab-container */}

      </main>

      {/* Modal de Consulta de Datos Históricos */}
      {historyModalOpen && (
        <div className="modal-overlay" onClick={() => setHistoryModalOpen(false)}>
          <div className="modal-content glass-panel history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <h3>Consulta de Datos Históricos</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button 
                  className="btn" 
                  onClick={handleDownloadExcel}
                  disabled={processedHistoryRecords.length === 0}
                  style={{ 
                    padding: '0.35rem 0.75rem', 
                    fontSize: '0.72rem', 
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'var(--accent)',
                    color: 'var(--text-dark)',
                    boxShadow: '0 0 10px var(--accent-glow)',
                    border: 'none',
                    fontWeight: 600,
                    cursor: processedHistoryRecords.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: processedHistoryRecords.length === 0 ? 0.5 : 1
                  }}
                >
                  <Download size={13} />
                  Descargar Excel
                </button>
                <button className="modal-close-btn" onClick={() => setHistoryModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            
            {/* Barra de Filtros Delgada */}
            <div className="history-filters-bar">
              <div className="history-filters-left">
                <div className="history-filter-item">
                  <label htmlFor="modal-finca"><MapPin size={11} /> Finca:</label>
                  <select 
                    id="modal-finca"
                    className="history-select" 
                    value={historyFinca} 
                    onChange={(e) => {
                      const newFinca = e.target.value;
                      setHistoryFinca(newFinca);
                      if (newFinca !== 'Todas') {
                        const pluvs = [...new Set(records.filter(r => r.finca === newFinca).map(r => r.pluviometro))];
                        if (historyPluviometro !== 'Todos' && !pluvs.includes(historyPluviometro)) {
                          setHistoryPluviometro('Todos');
                        }
                      }
                    }}
                  >
                    <option value="Todas">Todas</option>
                    {uniqueFincas.map(f => (
                      <option key={f} value={f}>
                        {FINCA_NAMES[f] || `Finca ${f}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="history-filter-item">
                  <label htmlFor="modal-pluv"><Layers size={11} /> Pluviómetro:</label>
                  <select 
                    id="modal-pluv"
                    className="history-select" 
                    value={historyPluviometro} 
                    onChange={(e) => setHistoryPluviometro(e.target.value)}
                  >
                    <option value="Todos">Todos</option>
                    {historyAvailablePluviometros.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div className="history-filter-item">
                  <label htmlFor="modal-anio"><Calendar size={11} /> Año:</label>
                  <select 
                    id="modal-anio"
                    className="history-select" 
                    value={historyAnio} 
                    onChange={(e) => setHistoryAnio(e.target.value)}
                  >
                    <option value="Todos">Todos</option>
                    {historyAvailableAnios.map(y => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </div>

                <div className="history-filter-item">
                  <label htmlFor="modal-mes"><Droplet size={11} /> Mes:</label>
                  <select 
                    id="modal-mes"
                    className="history-select" 
                    value={historyMes} 
                    onChange={(e) => setHistoryMes(e.target.value)}
                  >
                    <option value="Todos">Todos</option>
                    {["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Búsqueda Rápida */}
              <div className="history-filter-item">
                <Search size={11} style={{ color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  className="history-search-input" 
                  placeholder="Buscar pluviómetro/mes..." 
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                />
              </div>
            </div>

            {/* Tabla de Resultados */}
            <div className="history-table-container">
              <table className="history-table">
                <thead>
                  <tr>
                    <th onClick={() => requestHistorySort('semana')}>
                      SEMANA {historySortConfig.key === 'semana' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('finca')}>
                      FINCA {historySortConfig.key === 'finca' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('pluviometro')}>
                      PLUVIOMETRO {historySortConfig.key === 'pluviometro' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('anio')}>
                      AÑO {historySortConfig.key === 'anio' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('mesDesc')}>
                      MES_DESC {historySortConfig.key === 'mesDesc' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('dia')}>
                      DIA {historySortConfig.key === 'dia' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('prec')}>
                      PREC {historySortConfig.key === 'prec' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('mes')}>
                      MES {historySortConfig.key === 'mes' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th onClick={() => requestHistorySort('data')}>
                      DATA {historySortConfig.key === 'data' ? (historySortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {processedHistoryRecords.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                        No se encontraron registros que coincidan con los criterios.
                      </td>
                    </tr>
                  ) : (
                    processedHistoryRecords.map((r) => (
                      <tr key={r.id}>
                        <td>{r.semana}</td>
                        <td>{r.finca}</td>
                        <td>{r.pluviometro}</td>
                        <td>{r.anio}</td>
                        <td>{r.mesDesc}</td>
                        <td>{r.dia}</td>
                        <td style={{ fontWeight: r.prec > 0 ? '700' : 'normal', color: r.prec > 0 ? 'var(--accent)' : 'inherit' }}>
                          {r.prec.toFixed(1)}
                        </td>
                        <td>{r.mes}</td>
                        <td>{r.data}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pie del modal con total de registros */}
            <div className="history-pagination">
              <div className="history-pag-info">
                Mostrando <strong>{processedHistoryRecords.length.toLocaleString('es-ES')}</strong> registros encontrados
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Usa el scroll vertical para ver todos los datos
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Overlay para Configuración y Carga de Lluvias */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configuración y Gestión de Lluvias</h3>
              <button className="modal-close-btn" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {/* Cargar Lluvias */}
              <div className="modal-section">
                <h4>Actualizar Base de Datos (Subir Excel)</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Sube un archivo de Excel para consolidar el histórico. Los datos se guardarán localmente y se sincronizarán de manera automática en Firebase Cloud.
                </p>
                {syncStatus === 'uploading' || (loading && syncStatus === 'idle') ? (
                  <div className="glass-panel" style={{ padding: '2rem 1.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(255, 255, 255, 0.01)' }}>
                    <RefreshCw className="text-accent animate-spin" size={32} style={{ margin: '0 auto' }} />
                    <div>
                      <h5 style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                        {syncStatus === 'uploading' ? 'Sincronizando con Firebase Cloud...' : loadingSource}
                      </h5>
                    </div>
                    {syncStatus === 'uploading' && (
                      <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem', color: 'var(--text-muted)' }}>
                          <span>Progreso de subida...</span>
                          <span>{syncProgress.toLocaleString('es-ES')} / {syncTotal.toLocaleString('es-ES')} ({Math.round((syncProgress/syncTotal)*100)}%)</span>
                        </div>
                        <div style={{ width: '100%', height: '6px', background: 'var(--bg-input)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${(syncProgress/syncTotal)*100}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--accent))' }}></div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : syncStatus === 'success' ? (
                  <div className="glass-panel" style={{ padding: '2rem 1.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', borderColor: 'var(--success)', background: 'var(--success-glow)' }}>
                    <CheckCircle2 className="text-success" size={36} />
                    <h5 style={{ fontWeight: 700, fontSize: '1rem' }}>¡Actualización Exitosa!</h5>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      Se guardaron {syncTotal.toLocaleString('es-ES')} registros y se sincronizaron con éxito.
                    </p>
                  </div>
                ) : (
                  <div className="file-upload-zone" onClick={() => document.getElementById('excel-file-modal-input').click()} style={{ padding: '2rem 1.5rem' }}>
                    <input 
                      type="file" 
                      id="excel-file-modal-input" 
                      style={{ display: 'none' }} 
                      accept=".xlsx, .xls"
                      onChange={handleExcelUpload}
                    />
                    <Upload className="file-upload-icon" style={{ width: '32px', height: '32px', marginBottom: '0.5rem' }} />
                    <div>
                      <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>Haz clic aquí o arrastra un Excel para cargarlo</p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Formatos: .xlsx, .xls</p>
                    </div>
                  </div>
                )}
                {errorMessage && (
                  <div className="glass-panel" style={{ padding: '0.75rem 1rem', borderColor: 'var(--danger)', background: 'var(--danger-glow)', display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <AlertTriangle className="text-danger" size={20} style={{ flexShrink: 0 }} />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{errorMessage}</p>
                  </div>
                )}
                <div style={{ marginTop: '0.5rem' }}>
                  <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.85rem' }}>¿Estructura del Excel?</h5>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Asegúrate de que las columnas tengan los nombres correctos. Más información en el archivo: <code style={{ fontSize: '0.7rem', color: 'var(--text-main)' }}>BALANCE HIDRICO GHLG/data_historica/README.md</code>
                  </p>
                </div>
              </div>

              {/* Cargar Mapas de Fincas (SIG) */}
              <div className="modal-section" style={{ borderTop: '1px solid var(--border-light)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
                <h4>Cargar Mapas de Fincas (SIG)</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  Sube el archivo de lotes en formato GeoJSON para la finca seleccionada. Este mapa se guardará en la nube y se usará para colorear los lotes según su lluvia.
                </p>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div className="filter-group" style={{ minWidth: '150px', margin: 0 }}>
                    <label htmlFor="modal-map-finca-select" style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem' }}>Finca Destino</label>
                    <select 
                      id="modal-map-finca-select"
                      className="select-control"
                      value={mapUploadFinca}
                      onChange={(e) => setMapUploadFinca(e.target.value)}
                      style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', width: '100%' }}
                    >
                      <option value="HLG">HLG (01)</option>
                      <option value="HSL">HSL (02)</option>
                      <option value="TUC">TUC (03)</option>
                    </select>
                  </div>

                  <div style={{ flexGrow: 1 }}>
                    {mapUploadStatus === 'uploading' ? (
                      <div className="glass-panel" style={{ padding: '0.75rem 1rem', textAlign: 'center', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.01)', margin: 0 }}>
                        <RefreshCw className="text-accent animate-spin" size={16} />
                        <span style={{ fontSize: '0.8rem' }}>Subiendo mapa a Firebase Cloud...</span>
                      </div>
                    ) : mapUploadStatus === 'success' ? (
                      <div className="glass-panel" style={{ padding: '0.75rem 1rem', textAlign: 'center', display: 'flex', alignItems: 'center', gap: '0.5rem', borderColor: 'var(--success)', background: 'var(--success-glow)', margin: 0 }}>
                        <CheckCircle2 className="text-success" size={16} />
                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>¡Mapa cargado con éxito!</span>
                      </div>
                    ) : (
                      <div 
                        className="file-upload-zone" 
                        onClick={() => document.getElementById('geojson-file-modal-input').click()}
                        style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', height: 'auto', borderStyle: 'dashed' }}
                      >
                        <input 
                          type="file" 
                          id="geojson-file-modal-input" 
                          style={{ display: 'none' }} 
                          accept=".geojson, .json"
                          onChange={handleMapUpload}
                        />
                        <Upload size={14} className="text-muted" />
                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Seleccionar archivo GeoJSON</span>
                      </div>
                    )}
                  </div>
                </div>
                {mapUploadError && (
                  <div className="glass-panel" style={{ padding: '0.75rem 1rem', borderColor: 'var(--danger)', background: 'var(--danger-glow)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <AlertTriangle className="text-danger" size={16} style={{ flexShrink: 0 }} />
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{mapUploadError}</p>
                  </div>
                )}
              </div>

              {/* Cargar Información de Suelos (Excel) */}
              <div className="modal-section" style={{ borderTop: '1px solid var(--border-light)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
                <h4>Cargar Información de Suelos (Excel)</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  Sube el archivo Excel que contiene el tipo de suelo de los lotes. Estos datos se almacenarán localmente y se sincronizarán con Firebase Cloud para calcular capacidades específicas.
                </p>

                {soilUploadStatus === 'uploading' ? (
                  <div className="glass-panel" style={{ padding: '1.5rem 1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255, 255, 255, 0.01)' }}>
                    <RefreshCw className="text-accent animate-spin" size={24} style={{ margin: '0 auto' }} />
                    <div style={{ fontSize: '0.85rem' }}>Sincronizando suelos en la nube...</div>
                    <div style={{ width: '100%', maxWidth: '300px', margin: '0 auto' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '0.2rem', color: 'var(--text-muted)' }}>
                        <span>Subiendo...</span>
                        <span>{soilSyncProgress} / {soilSyncTotal} ({Math.round((soilSyncProgress/soilSyncTotal)*100)}%)</span>
                      </div>
                      <div style={{ width: '100%', height: '4px', background: 'var(--bg-input)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${(soilSyncProgress/soilSyncTotal)*100}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--accent))' }}></div>
                      </div>
                    </div>
                  </div>
                ) : soilUploadStatus === 'success' ? (
                  <div className="glass-panel" style={{ padding: '1.5rem 1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', borderColor: 'var(--success)', background: 'var(--success-glow)' }}>
                    <CheckCircle2 className="text-success" size={28} />
                    <h5 style={{ fontWeight: 700, fontSize: '0.9rem' }}>¡Suelos Cargados con Éxito!</h5>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      Se importaron {soilSyncTotal} registros correctamente.
                    </p>
                  </div>
                ) : (
                  <div className="file-upload-zone" onClick={() => document.getElementById('soils-file-modal-input').click()} style={{ padding: '1.5rem 1rem', borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', height: 'auto' }}>
                    <input 
                      type="file" 
                      id="soils-file-modal-input" 
                      style={{ display: 'none' }} 
                      accept=".xlsx, .xls"
                      onChange={handleSoilExcelUpload}
                    />
                    <Database size={18} className="text-accent" />
                    <div>
                      <p style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>Haz clic para seleccionar el Excel de suelos</p>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Formatos: .xlsx, .xls</p>
                    </div>
                  </div>
                )}

                {soilErrorMessage && (
                  <div className="glass-panel" style={{ padding: '0.75rem 1rem', borderColor: 'var(--danger)', background: 'var(--danger-glow)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <AlertTriangle className="text-danger" size={16} style={{ flexShrink: 0 }} />
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{soilErrorMessage}</p>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', background: 'rgba(255,255,255,0.01)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Registros de suelo cargados: <strong>{soils.length.toLocaleString('es-ES')}</strong>
                  </div>
                  {soils.length > 0 && (
                    <button 
                      onClick={handleClearSoils}
                      style={{ 
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--danger)',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 75, 75, 0.08)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Trash2 size={12} />
                      Borrar suelos local
                    </button>
                  )}
                </div>
              </div>

              {/* Parámetros de Suelo y Consumo de Cultivo */}
              <div className="modal-section">
                <h4>Parámetros de Suelo, Consumo y Umbral Seco</h4>
                
                {/* BLOQUE A — Fila superior de ETs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                  <div className="filter-group">
                    <label htmlFor="modal-input-et" style={{ fontSize: '0.8rem', fontWeight: 600 }}>ET₀ Referencial (mm/día)</label>
                    <input 
                      id="modal-input-et"
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="20"
                      className="select-control"
                      value={etReferencial}
                      onChange={(e) => setEtReferencial(parseFloat(e.target.value) || 0)}
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                    />
                  </div>
                  <div className="filter-group">
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Kc Activo (Palma)</label>
                    <input 
                      type="text"
                      className="select-control"
                      value={KC_ETAPAS[kcEtapaIndex]?.kc.toFixed(2) || '1.05'}
                      readOnly
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', background: 'rgba(255,255,255,0.02)', cursor: 'not-allowed', color: 'var(--accent)' }}
                    />
                  </div>
                  <div className="filter-group">
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>ETc Efectiva (mm/día)</label>
                    <input 
                      type="text"
                      className="select-control"
                      value={etcEfectiva.toFixed(2)}
                      readOnly
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', background: 'rgba(255,255,255,0.02)', cursor: 'not-allowed', color: 'var(--accent)', fontWeight: 'bold' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                      ETc = ET₀ × Kc (consumo real)
                    </span>
                  </div>
                </div>

                {/* Fila de Capacidad de Suelo y Umbral */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.75rem', borderTop: '1px dashed var(--border-light)', paddingTop: '0.75rem' }}>
                  <div className="filter-group">
                    <label htmlFor="modal-input-suelo" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Capacidad Suelo (mm)</label>
                    <input 
                      id="modal-input-suelo"
                      type="number"
                      step="5"
                      min="10"
                      max="300"
                      className="select-control"
                      value={capacidadSuelo}
                      onChange={(e) => setCapacidadSuelo(parseFloat(e.target.value) || 0)}
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                    />
                  </div>
                  <div className="filter-group">
                    <label htmlFor="modal-input-umbral" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Umbral Día Seco (mm)</label>
                    <input 
                      id="modal-input-umbral"
                      type="number"
                      step="0.1"
                      min="0"
                      max="50"
                      className="select-control"
                      value={umbralLluvia}
                      onChange={(e) => setUmbralLluvia(parseFloat(e.target.value) >= 0 ? parseFloat(e.target.value) : 0)}
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                    />
                  </div>
                </div>

                {/* BLOQUE B — Tabla interactiva de etapas */}
                <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-light)', paddingTop: '1rem' }}>
                  <h5 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Palette size={12} className="text-accent" />
                    Etapa de Cultivo Activa — Fuente: FAO-56 / CENIPALMA
                  </h5>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', background: 'rgba(0,0,0,0.2)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                          <th style={{ padding: '0.4rem 0.75rem' }}>Etapa</th>
                          <th style={{ padding: '0.4rem 0.75rem' }}>Edad (Años)</th>
                          <th style={{ padding: '0.4rem 0.75rem', width: '50px' }}>Kc</th>
                          <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>ETc con ET₀ actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {KC_ETAPAS.map((etapa, idx) => {
                          const isActive = idx === kcEtapaIndex;
                          const etcCalculada = (etReferencial * etapa.kc).toFixed(2);
                          return (
                            <tr 
                              key={idx}
                              onClick={() => {
                                setKcEtapaIndex(idx);
                                setKcCultivo(etapa.kc);
                              }}
                              style={{
                                cursor: 'pointer',
                                borderBottom: '1px solid rgba(255,255,255,0.03)',
                                transition: 'all 0.15s ease',
                                background: isActive ? 'rgba(0, 242, 254, 0.05)' : 'transparent',
                                color: isActive ? 'var(--accent)' : 'var(--text-main)',
                                borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                                fontWeight: isActive ? 600 : 'normal'
                              }}
                              onMouseEnter={(e) => {
                                if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                              }}
                              onMouseLeave={(e) => {
                                if (!isActive) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <td style={{ padding: '0.4rem 0.75rem' }}>{etapa.etapa}</td>
                              <td style={{ padding: '0.4rem 0.75rem' }}>
                                {etapa.edadMax === 99 ? `> ${etapa.edadMin}` : `${etapa.edadMin} - ${etapa.edadMax}`}
                              </td>
                              <td style={{ padding: '0.4rem 0.75rem' }}>{etapa.kc.toFixed(2)}</td>
                              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: isActive ? 'bold' : 'normal' }}>
                                {etcCalculada} mm/día
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block', textAlign: 'right' }}>
                    Fuente: FAO Irrigation Paper No. 56 (Allen et al., 1998) + CENIPALMA Colombia
                  </span>
                </div>
              </div>

              {/* Info Nube */}
              <div className="modal-section" style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CloudLightning size={14} className="text-success" />
                  Base de Datos Cloud Activa
                </span>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  Proyecto Firebase conectado de forma directa: **balance-hidrico-ghlg**
                </p>
              </div>

              {/* Botón Borrar Base Local */}
              {records.length > 0 && (
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={handleClearData} 
                    style={{ 
                      width: '100%', 
                      justifyContent: 'center',
                      borderColor: 'rgba(255, 75, 75, 0.2)',
                      color: 'var(--danger)',
                      padding: '0.6rem'
                    }}
                  >
                    <Trash2 size={16} />
                    Limpiar Vista de Datos Local
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Login de Administrador */}
      {showLoginModal && (
        <div className="modal-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="modal-content glass-panel" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Acceso de Administrador</h3>
              <button className="modal-close-btn" onClick={() => setShowLoginModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAdminLogin} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                Esta sección requiere credenciales de administrador para realizar modificaciones o subir archivos.
              </p>

              <div className="filter-group" style={{ margin: 0 }}>
                <label htmlFor="login-user" style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>Usuario</label>
                <input 
                  id="login-user"
                  type="text"
                  required
                  className="select-control"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', width: '100%' }}
                  placeholder="Introduce tu usuario"
                />
              </div>

              <div className="filter-group" style={{ margin: 0 }}>
                <label htmlFor="login-pass" style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>Contraseña</label>
                <input 
                  id="login-pass"
                  type="password"
                  required
                  className="select-control"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', width: '100%' }}
                  placeholder="Introduce tu contraseña"
                />
              </div>

              {loginError && (
                <div className="glass-panel" style={{ padding: '0.75rem 1rem', borderColor: 'var(--danger)', background: 'var(--danger-glow)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle className="text-danger" size={16} style={{ flexShrink: 0 }} />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{loginError}</p>
                </div>
              )}

              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={isLoggingIn}
                style={{ 
                  width: '100%', 
                  justifyContent: 'center', 
                  padding: '0.6rem',
                  fontSize: '0.9rem',
                  marginTop: '0.5rem'
                }}
              >
                {isLoggingIn ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} style={{ marginRight: '8px' }} />
                    Iniciando sesión...
                  </>
                ) : (
                  'Ingresar'
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;