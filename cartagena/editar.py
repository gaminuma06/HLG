#!/usr/bin/env python3
"""
Editor automático "Cartagena en fiesta".

Toma tus clips (y fotos), elige el mejor tramo de cada uno, los ajusta a
vertical 9:16, les quita el audio, les da un color cálido y festivo, los
corta al ritmo de la canción (ritmo.json) con transiciones en cada golpe y
les pone audio_limpio.wav.

Uso básico:
    python3 editar.py mis_videos/ -o cartagena_final.mp4

Opciones útiles:
    --titulo "Cartagena"     texto de entrada en los primeros segundos
    --preview                render rápido a 540x960 para revisar
    --sin-estabilizar        no estabilizar (más rápido)
    --look natural           color más suave (por defecto: fiesta)
    --horizontal relleno     clips horizontales con fondo desenfocado
                             (por defecto se recortan al centro)
    --orden fecha|nombre|dado  orden de los clips (por defecto: fecha)
    --plan archivo.plan.json  re-renderizar con un plan editado a mano

Cada render guarda <salida>.plan.json con qué tramo de qué clip se usó y
qué transición lleva, para poder ajustarlo y volver a renderizar.

Requiere: ffmpeg/ffprobe. numpy es opcional (sin él, se usa el centro de
cada clip en vez de buscar el tramo con más movimiento).
"""
import argparse, json, math, os, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

AQUI = os.path.dirname(os.path.abspath(__file__))
EXT_VIDEO = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".3gp", ".webm", ".mts"}
EXT_FOTO = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

TRANS = 0.30          # duración de cada transición (≈ medio golpe)
MARGEN_INICIO = 0.6   # se ignora el arranque del clip (cuando se pulsa grabar)
MARGEN_FIN = 0.4
VEL_MIN = 0.75        # cámara lenta máxima para estirar un clip corto
# Transiciones con energía de fiesta; cada 4.º corte es un destello blanco.
TRANSICIONES = ["slideleft", "zoomin", "smoothup", "circleopen", "slideright",
                "fade", "coverup", "radial", "smoothleft", "squeezeh",
                "slideup", "dissolve"]
DESTELLO = "fadewhite"

LOOKS = {
    # contraste/saturación altos, tonos cálidos (caribe al atardecer)
    "fiesta": ("eq=contrast=1.07:saturation=1.18:gamma={gamma},"
               "vibrance=intensity=0.18,"
               "colorbalance=rs=0.03:bs=-0.03:rm=0.04:gm=0.0:bm=-0.04:rh=0.02:bh=-0.03,"
               "vignette=angle=PI/6,unsharp=5:5:0.4"),
    "natural": "eq=contrast=1.03:saturation=1.07:gamma={gamma},unsharp=5:5:0.3",
}


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=kw.pop("text", True), **kw)
    if r.returncode != 0:
        sys.stderr.write((r.stderr if isinstance(r.stderr, str) else r.stderr.decode(errors="replace"))[-3000:])
        raise SystemExit(f"\nFalló: {' '.join(cmd[:6])} …")
    return r


def sondear(ruta):
    r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams",
             "-show_format", ruta])
    info = json.loads(r.stdout)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    if v is None:
        raise SystemExit(f"{ruta} no tiene video")
    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list", []):
        if "rotation" in sd:
            rot = int(sd["rotation"])
    rot = int(v.get("tags", {}).get("rotate", rot))
    if abs(rot) % 180 == 90:
        w, h = h, w
    tags = {**info["format"].get("tags", {}), **v.get("tags", {})}
    fecha = (tags.get("com.apple.quicktime.creationdate") or tags.get("creation_time") or "")
    dur = float(info["format"].get("duration") or v.get("duration") or 0)
    return {"w": w, "h": h, "dur": dur, "fecha": fecha,
            "trc": v.get("color_transfer", ""), "prim": v.get("color_primaries", ""),
            "mat": v.get("color_space", "")}


def analizar(ruta, dur):
    """Puntaje por instante: movimiento (baile, gente), nitidez y luz."""
    if np is None:
        return None
    fps, W, H = 6, 64, 112
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", ruta, "-an", "-vf",
                        f"fps={fps},scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
                       capture_output=True)
    f = np.frombuffer(r.stdout, np.uint8)
    n = len(f) // (W * H)
    if n < 3:
        return None
    f = f[: n * W * H].reshape(n, H, W).astype(np.float32)
    luz = f.mean((1, 2))
    mov = np.r_[0, np.abs(np.diff(f, axis=0)).mean((1, 2))]
    nit = np.abs(np.diff(f, axis=1)).mean((1, 2)) + np.abs(np.diff(f, axis=2)).mean((1, 2))

    def norm(a):
        lo, hi = np.percentile(a, 5), np.percentile(a, 95)
        return np.clip((a - lo) / (hi - lo + 1e-6), 0, 1)

    # movimiento "bueno": alto pero sin los picos de sacudida extrema
    m = norm(mov)
    m = np.where(mov > np.percentile(mov, 97) * 1.0, m * 0.6, m)
    score = 1.0 * m + 0.6 * norm(nit) - 0.8 * (luz < 35)
    return {"t": (np.arange(n) / fps).tolist(), "score": score.tolist(),
            "luz": float(np.median(luz))}


def mejor_ventana(c, largo, usadas):
    """Inicio del tramo de `largo` s con mejor puntaje, evitando lo ya usado."""
    ini_min = min(MARGEN_INICIO, max(0, (c["dur"] - largo) / 2))
    ini_max = max(ini_min, c["dur"] - largo - min(MARGEN_FIN, max(0, c["dur"] - largo - ini_min)))
    ini_max = max(0.0, min(ini_max, c["dur"] - largo))
    if c["foto"] or ini_max <= ini_min:
        return round(max(0.0, min(ini_min, ini_max)), 3)
    cands = [ini_min + i * 0.1 for i in range(int((ini_max - ini_min) / 0.1) + 1)]
    a = c.get("analisis")

    def punt(s):
        if a:
            v = [sc for t, sc in zip(a["t"], a["score"]) if s <= t <= s + largo]
            base = sum(v) / len(v) if v else 0
        else:
            base = -abs(s + largo / 2 - c["dur"] / 2)  # sin numpy: centro
        solape = sum(max(0, min(s + largo, b) - max(s, a_)) for a_, b in usadas)
        return base - 2.0 * solape / largo

    return round(max(cands, key=punt), 3)


def planificar(clips, ritmo, golpes_max):
    beats, D = ritmo["beats"], ritmo["duracion"]
    P = ritmo["periodo"]
    # Puntos de corte posibles: golpes pares (cada medio compás), sin el 0.
    cortes_pos = [b for i, b in enumerate(beats) if i % 2 == 0 and 0.9 < b < D - 1.0]
    unidades = len(cortes_pos) + 1                     # tramos de 2 golpes
    n = len(clips)
    max_u = max(1, golpes_max // 2)
    slots = max(n, math.ceil(unidades / max_u))
    if slots > unidades:                               # demasiados clips: quedan los mejores
        orden = sorted(range(n), key=lambda i: -clips[i]["calidad"])[:unidades]
        clips = [clips[i] for i in sorted(orden)]
        print(f"Aviso: hay más clips de los que caben a este ritmo; uso los {unidades} mejores.")
        n = slots = unidades
    # Repartir unidades lo más parejo posible, sin dar a un clip más tiempo
    # del que tiene (se admite cámara lenta hasta VEL_MIN). Si no alcanza,
    # se agregan tomas reutilizando otros tramos de los clips.
    def capacidad(c):
        if c["foto"]:
            return max_u
        return max(1, min(max_u, int((c["dur"] / VEL_MIN - TRANS) / (2 * P))))

    while True:
        caps = [capacidad(clips[k % n]) for k in range(slots)]
        tam, faltan = [1] * slots, unidades - slots
        while faltan > 0:
            libres = [k for k in range(slots) if tam[k] < caps[k]]
            if not libres:
                break
            nivel = min(tam[k] for k in libres)
            for k in libres:
                if tam[k] == nivel and faltan > 0:
                    tam[k] += 1
                    faltan -= 1
        if faltan == 0 or slots >= unidades:
            break
        slots += 1
    if faltan:  # clips demasiado cortos incluso a 2 golpes: se estira la última toma
        tam[-1] += faltan
    plan, idx_corte, usadas = [], 0, {}
    tiempos = [0.0]
    for u in tam[:-1]:
        idx_corte += u
        tiempos.append(cortes_pos[idx_corte - 1])
    tiempos.append(D)
    for k in range(slots):
        c = clips[k % n]
        a, b = tiempos[k], tiempos[k + 1]
        largo = (b - a) + (TRANS / 2 if k > 0 else 0) + (TRANS / 2 if k < slots - 1 else 0)
        # clip más corto que la toma: se usa entero (luego cámara lenta suave)
        largo_ok = largo if c["foto"] else min(largo, c["dur"])
        ini = mejor_ventana(c, largo_ok, usadas.setdefault(c["ruta"], []))
        usadas[c["ruta"]].append((ini, ini + largo_ok))
        trans = None
        if k > 0:
            trans = DESTELLO if k % 4 == 0 else TRANSICIONES[(k - 1) % len(TRANSICIONES)]
        plan.append({"clip": c["ruta"], "inicio": ini, "duracion": round(largo, 3),
                     "corte_en": round(a, 3), "transicion": trans})
    return plan


def filtro_clip(c, look, W, H, horizontal, estab_trf):
    f = []
    if c["trc"] in ("arib-std-b67", "smpte2084"):     # HDR de celular -> SDR
        f.append(f"zscale=tin={c['trc']}:pin=bt2020:min=bt2020nc:t=linear:npl=203,"
                 "format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,"
                 "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
    if estab_trf:
        f.append(f"vidstabtransform=input={estab_trf}:smoothing=12:optzoom=1:zoomspeed=0.2:interpol=bicubic")
    gamma = 1.0
    a = c.get("analisis")
    if a and a["luz"] < 70:                            # clip de noche: levantar sombras
        gamma = round(min(1.3, 1 + (70 - a["luz"]) / 150), 2)
    horizontal_clip = c["w"] > c["h"] * 1.05 and W < H
    if horizontal_clip and horizontal == "relleno":
        f.append(f"split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                 f"gblur=sigma=30,eq=brightness=-0.08[fondo];[b]scale={W}:-2[fr];[fondo][fr]overlay=0:(H-h)/2")
    else:
        f.append(f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}")
    f.append(LOOKS[look].format(gamma=gamma))
    f.append("setsar=1")
    return ",".join(f)


def renderizar_tramo(i, s, c, args, W, H, tmp):
    salida = os.path.join(tmp, f"tramo_{i:02d}.mp4")
    frames = int(round(s["duracion"] * args.fps))
    if c["foto"]:
        zp = (f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},"
              f"zoompan=z='1+0.10*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={args.fps}")
        vf = zp + "," + LOOKS[args.look].format(gamma=1.0) + ",setsar=1,format=yuv420p"
        run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", c["ruta"], "-vf", vf,
             "-frames:v", str(frames), "-c:v", "libx264", "-preset", "fast", "-crf", "16", salida])
        return salida
    fuente = s["duracion"]
    disponible = c["dur"] - s["inicio"]
    velocidad = 1.0
    if disponible < fuente:                            # clip corto: cámara lenta suave
        velocidad = max(VEL_MIN, disponible / fuente)
    leer = fuente * velocidad + 0.2
    entrada = ["-ss", f"{s['inicio']:.3f}", "-t", f"{leer:.3f}", "-i", c["ruta"]]
    trf = None
    if args.estabilizar:
        trf = os.path.join(tmp, f"tramo_{i:02d}.trf")
        run(["ffmpeg", "-y", "-v", "error", *entrada, "-an", "-vf",
             f"vidstabdetect=shakiness=6:accuracy=12:result={trf}", "-f", "null", "-"])
    vf = filtro_clip(c, args.look, W, H, args.horizontal, trf)
    # tpad congela el último cuadro si aun así faltara material: cada toma
    # debe durar exactamente lo planeado o se desfasan los cortes.
    vf += (f",setpts=(PTS-STARTPTS)/{velocidad},fps={args.fps},"
           f"tpad=stop_mode=clone:stop_duration={fuente:.3f},format=yuv420p")
    run(["ffmpeg", "-y", "-v", "error", *entrada, "-an", "-filter_complex", f"[0:v:0]{vf}[v]",
         "-map", "[v]", "-frames:v", str(frames), "-c:v", "libx264", "-preset", "fast",
         "-crf", "16", salida])
    return salida


def ensamblar(tramos, plan, ritmo, args, W, H, salida):
    D = ritmo["duracion"]
    entradas, g = [], []
    for i, t in enumerate(tramos):
        entradas += ["-i", t]
        g.append(f"[{i}:v]settb=AVTB,fps={args.fps},format=yuv420p[t{i}]")
    prev = "t0"
    for k in range(1, len(tramos)):
        off = plan[k]["corte_en"] - TRANS / 2
        g.append(f"[{prev}][t{k}]xfade=transition={plan[k]['transicion']}:duration={TRANS}:offset={off:.3f}[x{k}]")
        prev = f"x{k}"
    fin = [f"fade=t=in:st=0:d=0.25", f"fade=t=out:st={D-0.7:.3f}:d=0.7"]
    if args.titulo:
        fuente = "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
        if not os.path.exists(fuente):
            fuente = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        txt = args.titulo.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")
        t1 = ritmo["beats"][4] if len(ritmo["beats"]) > 4 else 2.5
        alpha = f"if(lt(t,0.3),t/0.3,if(lt(t,{t1-0.3:.2f}),1,max(0,({t1:.2f}-t)/0.3)))"
        tam = int(W * 0.13)
        fin.append(f"drawtext=fontfile={fuente}:text='{txt}':fontsize={tam}:fontcolor=white:"
                   f"borderw={max(2, tam//18)}:bordercolor=black@0.35:shadowcolor=black@0.5:shadowx=0:shadowy={tam//20}:"
                   f"x=(w-text_w)/2:y=h*0.40:alpha='{alpha}':enable='lt(t,{t1:.2f})'")
    g.append(f"[{prev}]" + ",".join(fin) + "[v]")
    audio = os.path.join(AQUI, ritmo.get("audio", "audio_limpio.wav"))
    g.append(f"[{len(tramos)}:a]afade=t=out:st={D-1.2:.3f}:d=1.2[a]")
    calidad = ["-preset", "veryfast", "-crf", "26"] if args.preview else ["-preset", "slow", "-crf", "18", "-maxrate", "12M", "-bufsize", "24M"]
    run(["ffmpeg", "-y", "-v", "error", *entradas, "-i", audio,
         "-filter_complex", ";".join(g), "-map", "[v]", "-map", "[a]", "-t", f"{D:.3f}",
         "-c:v", "libx264", *calidad, "-profile:v", "high", "-pix_fmt", "yuv420p",
         "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", salida])


def recolectar(rutas):
    out = []
    for r in rutas:
        if os.path.isdir(r):
            for f in sorted(os.listdir(r)):
                p = os.path.join(r, f)
                if os.path.splitext(f)[1].lower() in EXT_VIDEO | EXT_FOTO and os.path.isfile(p):
                    out.append(p)
        elif os.path.isfile(r):
            out.append(r)
        else:
            raise SystemExit(f"No existe: {r}")
    return out


def main():
    ap = argparse.ArgumentParser(description="Edita tus clips de Cartagena al ritmo de la canción.")
    ap.add_argument("clips", nargs="*", help="archivos o carpetas con videos/fotos")
    ap.add_argument("-o", "--salida", default="cartagena_final.mp4")
    ap.add_argument("--titulo", default="")
    ap.add_argument("--look", choices=LOOKS, default="fiesta")
    ap.add_argument("--horizontal", choices=["recorte", "relleno"], default="recorte")
    ap.add_argument("--orden", choices=["fecha", "nombre", "dado"], default="fecha")
    ap.add_argument("--golpes-max", type=int, default=6,
                    help="máximo de golpes por toma (6 ≈ 3.6 s). Menos = más rápido")
    ap.add_argument("--sin-estabilizar", dest="estabilizar", action="store_false")
    ap.add_argument("--preview", action="store_true", help="render rápido 540x960")
    ap.add_argument("--plan", help="usar un .plan.json existente (editado a mano)")
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()

    ritmo = json.load(open(os.path.join(AQUI, "ritmo.json")))
    W, H = (540, 960) if args.preview else (1080, 1920)

    if args.plan:
        plan = json.load(open(args.plan))["tramos"]
        rutas = list(dict.fromkeys(s["clip"] for s in plan))
    else:
        rutas = recolectar(args.clips)
        if not rutas:
            raise SystemExit("No encontré clips. Uso: python3 editar.py carpeta_de_videos/ -o final.mp4")

    clips = {}
    for i, r in enumerate(rutas):
        foto = os.path.splitext(r)[1].lower() in EXT_FOTO
        c = {"ruta": r, "foto": foto, "orden": i}
        if foto:
            c.update({"w": 0, "h": 0, "dur": 999.0, "fecha": "", "trc": "", "calidad": 0.3})
        else:
            c.update(sondear(r))
            if not args.plan:
                print(f"Analizando {os.path.basename(r)} ({c['dur']:.1f}s, {c['w']}x{c['h']}"
                      f"{', HDR' if c['trc'] in ('arib-std-b67','smpte2084') else ''})")
            c["analisis"] = analizar(r, c["dur"])
            sc = c["analisis"]["score"] if c["analisis"] else [0.5]
            c["calidad"] = sum(sorted(sc)[len(sc)//2:]) / max(1, len(sc) - len(sc)//2)
        clips[r] = c

    if not args.plan:
        lista = list(clips.values())
        if args.orden in ("fecha", "nombre"):
            lista.sort(key=lambda c: os.path.basename(c["ruta"]).lower())
        if args.orden == "fecha" and any(c["fecha"] for c in lista):
            # lo que no tiene fecha (p. ej. fotos) hereda la del archivo anterior por nombre
            ultima = ""
            for c in lista:
                ultima = c["fecha"] or ultima
                c["fecha_orden"] = ultima
            lista.sort(key=lambda c: c["fecha_orden"])
        plan = planificar(lista, ritmo, args.golpes_max)

    print(f"\n{len(plan)} tomas, cortes al ritmo ({ritmo['bpm']} BPM):")
    for k, s in enumerate(plan):
        print(f"  {s['corte_en']:6.2f}s  {os.path.basename(s['clip']):28s} desde {s['inicio']:5.2f}s "
              f"({s['duracion']:.2f}s)  {s['transicion'] or 'inicio'}")

    tmp = tempfile.mkdtemp(prefix="cartagena_")
    try:
        def procesar(i):
            s = plan[i]
            t = renderizar_tramo(i, s, clips[s["clip"]], args, W, H, tmp)
            esperado = int(round(s["duracion"] * args.fps))
            r = run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v",
                     "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", t])
            if int(r.stdout.strip() or 0) != esperado:
                raise SystemExit(f"La toma {i+1} salió con {r.stdout.strip()} cuadros, se esperaban {esperado}")
            print(f"  toma {i+1}/{len(plan)} lista", flush=True)
            return t

        # vidstab usa un solo núcleo: varias tomas a la vez aprovechan la CPU
        hilos = max(1, min(len(plan), (os.cpu_count() or 2)))
        print(f"Procesando {len(plan)} tomas ({hilos} a la vez)…", flush=True)
        with ThreadPoolExecutor(hilos) as ex:
            tramos = list(ex.map(procesar, range(len(plan))))
        print("Uniendo con transiciones y música…", flush=True)
        ensamblar(tramos, plan, ritmo, args, W, H, args.salida)
        r = run(["ffprobe", "-v", "error", "-select_streams", "v", "-count_packets",
                 "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", args.salida])
        esperado = int(ritmo["duracion"] * args.fps)
        if abs(int(r.stdout.strip() or 0) - esperado) > 1:
            raise SystemExit(f"El video final tiene {r.stdout.strip()} cuadros; se esperaban ~{esperado}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    with open(os.path.splitext(args.salida)[0] + ".plan.json", "w") as fh:
        json.dump({"tramos": plan}, fh, indent=1, ensure_ascii=False)
    print(f"\nListo: {args.salida}")


if __name__ == "__main__":
    main()
