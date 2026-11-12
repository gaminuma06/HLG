#!/usr/bin/env bash
# Une tus clips de Cartagena y les pone el audio limpio.
#
# Uso:
#   ./montar.sh salida.mp4 clip1.mp4 clip2.mov clip3.mp4 ...
#
# - Los clips se unen en el orden en que los pases.
# - Cada clip se ajusta a vertical 1080x1920 (9:16) a 30 fps, recortando
#   los bordes si hace falta (no deforma la imagen).
# - Se descarta el audio propio de los clips; solo queda audio_limpio.wav.
# - El video final dura lo que dure el más corto entre el audio (~30 s)
#   y la suma de tus clips. El audio termina con un fundido de 1 s.
#
# Variables opcionales:
#   AUDIO=otro.wav  W=1920 H=1080  (para horizontal)  FPS=30
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIO="${AUDIO:-$DIR/audio_limpio.wav}"
W="${W:-1080}"; H="${H:-1920}"; FPS="${FPS:-30}"

if [ "$#" -lt 2 ]; then
  echo "Uso: $0 salida.mp4 clip1 [clip2 ...]" >&2
  exit 1
fi
OUT="$1"; shift
N="$#"

inputs=(); filters=""; labels=""
i=0
for clip in "$@"; do
  inputs+=(-i "$clip")
  filters+="[$i:v:0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[v$i];"
  labels+="[v$i]"
  i=$((i+1))
done
filters+="${labels}concat=n=${N}:v=1:a=0[vid]"

# Duración final = mínimo entre audio y suma de clips
adur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO")
vdur=0
for clip in "$@"; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip")
  vdur=$(awk -v a="$vdur" -v b="$d" 'BEGIN{print a+b}')
done
dur=$(awk -v a="$adur" -v v="$vdur" 'BEGIN{print (a<v)?a:v}')
fade_start=$(awk -v d="$dur" 'BEGIN{s=d-1; print (s>0)?s:0}')

ffmpeg -hide_banner -y "${inputs[@]}" -i "$AUDIO" \
  -filter_complex "$filters;[${N}:a]afade=t=out:st=${fade_start}:d=1[aud]" \
  -map "[vid]" -map "[aud]" -t "$dur" \
  -c:v libx264 -preset medium -crf 20 -profile:v high \
  -c:a aac -b:a 192k -movflags +faststart \
  "$OUT"

echo "Listo: $OUT (${dur}s; audio ${adur}s, clips ${vdur}s)"
