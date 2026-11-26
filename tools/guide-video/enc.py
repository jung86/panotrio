import json, subprocess, sys
for n in sys.argv[1:]:
    j = json.load(open(n + '.json')); m = dict((k, v) for k, v in j['marks'])
    segs = [k for k in j['marks']]
    # fast segments: marks 'ffN' and 'nfN' (normal again), speed in mark name ffN@x
    a, b = m['start'], m['end']
    fast = []
    cur = None
    for k, t in j['marks']:
        if k.startswith('ff'): cur = (t, float(k.split('@')[1]) if '@' in k else 3.0)
        if k.startswith('nf') and cur: fast.append((cur[0], t, cur[1])); cur = None
    parts, t = [], a
    for (s, e, sp) in fast:
        parts.append((t, s, 1.0)); parts.append((s, e, sp)); t = e
    parts.append((t, b, 1.0))
    # frames -> 25 fps sequence on the wall clock, then the cut list below works in seconds
    fr = j['frames']; import os
    lst = f'raw/{n}.txt'
    with open(lst, 'w') as f:
        for k, (fn, t) in enumerate(fr):
            d = (fr[k + 1][1] - t) if k + 1 < len(fr) else 0.04
            f.write(f"file '{fn}'\nduration {max(d, 0.001):.3f}\n")
        f.write(f"file '{fr[-1][0]}'\n")
    base = f'raw/{n}-base.mp4'
    off = fr[0][1]
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',lst,'-vf','fps=25,scale=780:1688:force_original_aspect_ratio=decrease,pad=780:1688:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p', base], check=True)
    a -= off; b -= off
    parts = [(max(0, s - off), e - off, sp) for (s, e, sp) in parts]
    fl, labels = [], []
    for i, (s, e, sp) in enumerate(parts):
        if e - s < 0.05: continue
        fl.append(f"[0:v]trim={s:.3f}:{e:.3f},setpts=(PTS-STARTPTS)/{sp},fps=25[v{i}]"); labels.append(f"[v{i}]")
    fc = ';'.join(fl) + ';' + ''.join(labels) + f"concat=n={len(labels)}:v=1:a=0,scale=720:-2[o]"
    out = f'out/{n}.mp4'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i', base, '-filter_complex', fc, '-map','[o]','-c:v','libx264','-preset','slow','-crf','30','-pix_fmt','yuv420p','-movflags','+faststart', out], check=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-ss','6','-i', out, '-frames:v','1','-q:v','5', f'out/{n}.jpg'], check=True)
    print(n, subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,size','-of','csv=p=0', out], capture_output=True, text=True).stdout.strip())
