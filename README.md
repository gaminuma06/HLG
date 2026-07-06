# GAHLG Balance Hídrico

Una aplicación web interactiva de monitoreo pluviométrico, mapas y balance hídrico diseñada para optimizar y controlar la eficiencia del agua en el cultivo de palma de aceite.

---

## 🚀 Características Principales

1. **Monitoreo Pluviométrico**: 
   - Visualización analítica de precipitación acumulada por finca, pluviómetro, año y mes.
   - Historial detallado de eventos de lluvia y cálculo dinámico de días secos consecutivos.
   - Gráfico de precipitaciones promedio ponderadas y máximas anuales/mensuales.

2. **Balance Hídrico Dinámico**:
   - Monitoreo del balance hídrico del cultivo basado en parámetros técnicos de suelo y riego:
     - **ET₀** (Evapotranspiración de referencia)
     - **Kc** (Coeficiente del cultivo)
     - **ETc** (Evapotranspiración del cultivo)
     - **Umbral seco** y **Suelo útil**
   - Gráficos interactivos de balance acumulado y precipitaciones diarias por finca/lote.

3. **Mapas de Fincas y Lotes**:
   - Integración cartográfica interactiva mediante Leaflet para georreferenciación de lotes, fincas y pluviómetros.
   - Capas dinámicas de humedad del suelo con degradados visuales intuitivos.

4. **Gestión de Datos y Sincronización en la Nube**:
   - Carga e importación rápida de registros mediante archivos Excel (.xlsx).
   - Base de datos dual: **IndexedDB** local (para funcionamiento sin conexión) sincronizada en tiempo real con **Firebase Realtime Database** en la nube.
   - Descarga de reportes en Excel y exportación de gráficos a imágenes JPG/PNG de alta definición adaptados para navegadores modernos (Microsoft Edge).

---

## 🎨 Animación del Logotipo (Anime.js)

El logotipo de la aplicación cuenta con una animación cíclica y reactiva de alta calidad que representa el ciclo del agua y el cultivo:
- **Secuencia**:
  1. **Caída e Impacto**: Una gota de agua de color celeste cae desde la parte superior, se estira en el descenso, impacta la base achatándose y desaparece.
  2. **Salpicadura (Splash)**: Al chocar la gota, microgotas salpican radialmente hacia los lados de forma fluida.
  3. **Nacimiento de la Palma**: En la base del impacto brota una palma de aceite a gran escala (escala 2.2) con el tronco café (`#8B5A2B`) y hojas verdes (`#00c853`). La palma se mantiene estática durante 2 segundos para poder ser apreciada y luego se desvanece suavemente.
  4. **Recomposición**: La gota original vuelve a formarse con un efecto de rebote elástico.
  5. **Pausa de Ciclo**: La gota reposa fija durante 1 minuto antes de subir flotando y comenzar la secuencia nuevamente.
- **Interactividad**: Al hacer clic sobre el logotipo en cualquier momento, el hilo de animación previo se limpia de forma segura y la animación se reinicia de inmediato desde el fotograma cero.

---

## 🛠️ Tecnologías y Librerías Utilizadas

- **Framework**: [React](https://react.dev/) + [Vite](https://vitejs.dev/) (Rápido y ligero)
- **Base de Datos**: [Firebase Realtime Database](https://firebase.google.com/) + IndexedDB (Local-first con sincronización)
- **Animaciones**: [Anime.js](https://animejs.com/) (Control preciso de fotogramas clave y vectores)
- **Cartografía**: [Leaflet](https://leafletjs.com/) + [React Leaflet](https://react-leaflet.js.org/)
- **Visualización de Datos**: [Chart.js](https://www.chartjs.org/) + [React Chartjs 2](https://react-chartjs-2.js.org/)
- **Procesamiento de Archivos**: [SheetJS (XLSX)](https://sheetjs.com/)
- **Iconografía**: [Lucide React](https://lucide.dev/)

---

## 📦 Instalación y Configuración Local

1. **Clonar el repositorio**:
   ```bash
   git clone https://github.com/gaminuma06/balance-hidrico-ghlg.git
   cd balance-hidrico-ghlg
   ```

2. **Instalar dependencias**:
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**:
   Crea o verifica tu configuración de Firebase en el archivo [src/firebaseConfig.js](src/firebaseConfig.js) con tus credenciales de base de datos.

4. **Correr el servidor local de desarrollo**:
   ```bash
   npm run dev
   ```

5. **Visualizar la App**:
   Abre [http://localhost:5173/](http://localhost:5173/) en tu navegador preferido (compatible y probado en Microsoft Edge).
