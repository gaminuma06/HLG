# Cartagena en fiesta — kit de edición

Todo está listo para armar el video apenas lleguen tus clips.

| Archivo | Para qué |
|---|---|
| `audio_limpio.wav` | La música del video de referencia, sin imagen, con volumen ajustado para redes (-14 LUFS). |
| `audio_original.m4a` | Copia exacta del audio original, sin tocar. |
| `ritmo.json` | El ritmo de la canción ya medido: **99 BPM**, un golpe cada 0.605 s, 30 s de duración. |
| `editar.py` | El editor automático (FFmpeg). |

## Qué hace el editor con tus videos

1. **Quita el audio** de todos tus clips; solo suena `audio_limpio.wav`.
2. **Elige el mejor tramo** de cada clip: busca donde hay más movimiento (baile, gente), buena nitidez y luz, y descarta el arranque y el final (cuando aprietas grabar/parar).
3. **Ajusta a vertical 9:16** (1080×1920, 30 fps) recortando sin deformar. Corrige la rotación del celular.
4. **Convierte HDR** del iPhone (Dolby Vision/HLG) para que no salga lavado en Instagram/WhatsApp.
5. **Estabiliza** el movimiento de la mano.
6. **Color "fiesta"**: más contraste, colores vivos y tonos cálidos caribeños; aclara automáticamente los clips de noche.
7. **Corta al ritmo**: cada cambio de toma cae exactamente en un golpe de la música, con transiciones cortas (barridos, zoom, círculos) y un **destello blanco** cada 4 cortes para dar golpe de fiesta.
8. Título opcional al inicio, fundido a negro y de la música al final.

Si hay pocos clips, reutiliza otros tramos del mismo clip; si hay muchos, se queda con los mejores. Los clips cortos se alargan con una cámara lenta suave.

## Cómo grabar (para que quede espectacular)

- **Vertical**, 1080p o 4K, a **30 o 60 fps**. El HDR puede quedar activado.
- **Clips de 5 a 15 segundos**. Mantén la toma 2 segundos quieta al empezar y al terminar.
- **Entre 10 y 20 clips** es lo ideal para 30 segundos (cortes cada ~2–3 s).
- Limpia el lente, no uses zoom digital; mejor acércate caminando.
- **Mezcla planos**: generales (la muralla, una calle), medios (tú en escena) y detalles (tu bebida, pies bailando, manos aplaudiendo, risas).
- Que alguien te grabe **disfrutando**: bailando champeta, brindando, riendo, caminando de espaldas hacia la cámara y volteando.

Ideas en la ciudad amurallada:
- Torre del Reloj al entrar, calles con balcones y buganvillas, coches de caballos.
- Atardecer en las murallas (Baluarte de Santo Domingo).
- Getsemaní de noche: Plaza de la Trinidad, murales, calle de las sombrillas.
- Palenqueras con sus frutas (pide permiso), músicos callejeros.
- Chiva rumbera, discoteca o rumba en la calle: el clímax del video.

## Cómo enviármelos

Súbelos aquí al chat **en su archivo original** (no reenviados por WhatsApp, que los comprime). Si son muy pesados, compártelos por Google Drive.

Al recibirlos, reviso cada clip cuadro por cuadro y ordeno las tomas para contar una historia: llegada de día → atardecer en la muralla → noche de fiesta → clímax bailando → cierre. Luego te paso una versión para revisar y la ajustamos.

## Uso (referencia técnica)

```bash
# Automático (orden por fecha de grabación)
python3 editar.py carpeta_de_clips/ -o cartagena_final.mp4 --titulo "Cartagena"

# Vista previa rápida
python3 editar.py carpeta_de_clips/ -o prueba.mp4 --preview --sin-estabilizar

# Ajuste fino: editar cartagena_final.plan.json (tramo, transición) y re-renderizar
python3 editar.py --plan cartagena_final.plan.json -o cartagena_v2.mp4
```

Otras opciones: `--look natural` (color suave), `--horizontal relleno` (clips horizontales sobre fondo desenfocado en vez de recorte), `--golpes-max 4` (cortes más rápidos), `--orden nombre|dado`.
