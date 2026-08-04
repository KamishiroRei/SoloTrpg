"""
SoloTrpg - GUI启动器
内嵌WebView显示游戏界面，内置Flask后端服务
打包为单文件EXE，双击即玩，无需任何外部依赖
"""
import os, sys, json, threading, base64, io, subprocess
from pathlib import Path

# ── 路径 ──
if getattr(sys, 'frozen', False):
    EXE_DIR = Path(os.path.dirname(sys.executable))
    APP_DIR = Path(sys._MEIPASS) / 'app'
else:
    EXE_DIR = Path(__file__).parent
    APP_DIR = EXE_DIR / 'app'

# 首次运行：解压内嵌的app/文件
def extract_app():
    if APP_DIR.exists(): return
    APP_DIR.mkdir(parents=True)
    # 文件嵌入在EXE中，这里从同目录复制（开发模式）或从模板创建
    pass

# ── Flask 后端 ──
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import flask

app_flask = Flask(__name__, static_folder=str(APP_DIR), static_url_path='')
CORS(app_flask)

@app_flask.route('/')
def index():
    return send_from_directory(str(APP_DIR), 'index.html')

@app_flask.route('/api/health')
def health():
    return jsonify({"status": "ok", "time": __import__('datetime').datetime.now().isoformat()})

@app_flask.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    data = request.json
    messages = data.get('messages', [])
    provider = data.get('provider', 'gpt')
    
    config = load_config()
    prov = config.get('ai', {}).get('providers', {}).get(provider, {})
    if not prov.get('apiKey'):
        return jsonify({"error": "未配置API Key"}), 400
    
    import urllib.request, ssl
    ctx = ssl.create_default_context()
    body = json.dumps({
        "model": prov.get('model', 'gpt-4o'),
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 4096
    }).encode()
    
    req = urllib.request.Request(prov['endpoint'], data=body, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {prov["apiKey"]}'
    }, method='POST')
    
    try:
        resp = urllib.request.urlopen(req, timeout=120, context=ctx)
        result = json.loads(resp.read())
        if result.get('choices'):
            return jsonify({
                "content": result['choices'][0]['message']['content'],
                "model": result.get('model'),
                "usage": result.get('usage')
            })
        return jsonify({"error": "AI返回异常"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app_flask.route('/api/ai/models', methods=['POST'])
def ai_models():
    provider = request.json.get('provider', 'gpt')
    config = load_config()
    prov = config.get('ai', {}).get('providers', {}).get(provider, {})
    
    presets = {'gpt': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'], 'custom': []}
    
    # 尝试从API获取真实模型列表
    if prov.get('apiKey') and prov.get('endpoint'):
        try:
            import urllib.request, ssl, json as j
            base = prov['endpoint'].replace('/chat/completions', '').replace('/v1/', '/v1')
            models_url = base.rstrip('/') + '/models' if '/v1' in base else base + '/v1/models'
            req = urllib.request.Request(models_url, headers={'Authorization': f'Bearer {prov["apiKey"]}'})
            resp = urllib.request.urlopen(req, timeout=8, context=ssl.create_default_context())
            data = j.loads(resp.read())
            if data.get('data'):
                models = [m['id'] for m in data['data']]
                return jsonify({"models": sorted(models), "provider": provider, "fetched": True})
        except:
            pass
    
    return jsonify({"models": presets.get(provider, []), "provider": provider, "preset": True})

@app_flask.route('/api/rules/list')
def rules_list():
    ruler_dir = EXE_DIR / 'Ruler'
    if not ruler_dir.exists(): return jsonify([])
    systems = []
    for d in ruler_dir.iterdir():
        if d.is_dir():
            mdir = d / '模组'; adir = d / '存档'
            files = [f.name for f in d.iterdir() if f.suffix == '.md' and f.name != 'SKILL.md']
            modules = [m.name for m in mdir.iterdir()] if mdir.exists() else []
            archives = [a.name for a in adir.iterdir()] if adir.exists() else []
            systems.append({
                "name": d.name,
                "files": files,
                "modules": modules,
                "archives": archives
            })
    return jsonify(systems)

@app_flask.route('/api/rules/read')
def rules_read():
    system = request.args.get('system', '')
    file = request.args.get('file', '')
    sub = request.args.get('sub', '')  # 'module' or 'archive'
    subname = request.args.get('subname', '')
    
    base = EXE_DIR / 'Ruler' / system
    if sub == 'module': base = base / '模组' / subname
    elif sub == 'archive': base = base / '存档' / subname
    
    path = (base / file).resolve() if file else base
    if not str(path).startswith(str(EXE_DIR / 'Ruler')): return jsonify({"error": "禁止"}), 403
    if not path.exists(): return jsonify({"error": "不存在"}), 404
    if path.is_dir():
        files = [{"name": f.name, "type": "file"} for f in path.iterdir() if f.is_file()]
        return jsonify({"files": files, "system": system, "path": str(path.relative_to(EXE_DIR / 'Ruler'))})
    return jsonify({"content": path.read_text(encoding='utf-8'), "system": system, "file": file})

# ── 文件上传与规则书拆解 ──────────────────────────

@app_flask.route('/api/files/upload', methods=['POST'])
def file_upload():
    f = request.files.get('file')
    if not f: return jsonify({"error": "无文件"}), 400
    system_name = request.form.get('system', '').strip() or os.path.splitext(f.filename)[0]
    safe_name = system_name.replace('/', '_').replace('\\', '_')
    ruler_dir = EXE_DIR / 'Ruler' / safe_name
    source_dir = ruler_dir / 'source'
    source_dir.mkdir(parents=True, exist_ok=True)
    ext = os.path.splitext(f.filename)[1].lower()
    upload_path = source_dir / f.filename
    f.save(str(upload_path))
    result = {"system": safe_name, "file": f.filename, "type": ext}
    
    if ext == '.chm':
        try:
            import subprocess, shutil, re
            extract_dir = source_dir / '_extract'
            if extract_dir.exists(): shutil.rmtree(extract_dir)
            extract_dir.mkdir()
            subprocess.run(['hh.exe', '-decompile', str(extract_dir), str(upload_path)], timeout=60, capture_output=True, check=False)
            all_text = []
            for hf in sorted(extract_dir.rglob('*.htm*')):
                try:
                    html = hf.read_text(encoding='utf-8', errors='ignore')
                    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL|re.I)
                    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL|re.I)
                    html = re.sub(r'<[^>]+>', '\n', html)
                    html = html.replace('&nbsp;',' ').replace('&lt;','<').replace('&gt;','>').replace('&amp;','&')
                    html = re.sub(r'\n{3,}', '\n\n', html)
                    rel = str(hf.relative_to(extract_dir))
                    all_text.append(f"=== {rel} ===\n{html.strip()}")
                except: pass
            merged = '\n\n'.join(all_text)
            pages = [p.strip() for p in re.split(r'={3,}\s*\S+\.htm[l]?\s*={3,}', merged) if p.strip()]
            for i, page in enumerate(pages[:100]):
                m = re.search(r'^={3,}\s*(.+?)\s*={3,}', page)
                title = m.group(1) if m else f'page_{i+1}'
                (source_dir / f'{safe_title(title)}.md').write_text(f'# {title}\n\n{page}', encoding='utf-8')
            shutil.rmtree(extract_dir, ignore_errors=True)
            result['pages'] = len(pages)
        except Exception as e: result['error'] = str(e)
    
    elif ext == '.pdf':
        try:
            import re
            text = ''
            try:
                import fitz
                doc = fitz.open(str(upload_path))
                for page in doc: text += page.get_text() + '\n\n---\n\n'
                doc.close()
            except:
                text = upload_path.read_bytes().decode('utf-8', errors='ignore')
                text = ''.join(c if c.isprintable() or c in '\n\r\t' else ' ' for c in text)
            chapters = [c.strip() for c in text.split('\n---\n') if len(c.strip()) > 200]
            for i, ch in enumerate(chapters[:50]):
                lines = ch.strip().split('\n')
                title = lines[0][:80] if lines else f'章节{i+1}'
                (source_dir / f'{safe_title(title)}.md').write_text(f'# {title}\n\n{ch}', encoding='utf-8')
            result['chapters'] = len(chapters)
        except Exception as e: result['error'] = str(e)
    
    elif ext in ('.txt', '.md'):
        import re
        text = upload_path.read_text(encoding='utf-8', errors='ignore')
        sections = [s.strip() for s in re.split(r'\n#{1,3}\s+', text) if s.strip()] if len(text) > 30000 else [text]
        for i, sec in enumerate(sections[:30]):
            title = sec.split('\n')[0][:60] if '\n' in sec else f'section_{i+1}'
            (source_dir / f'{safe_title(title)}.md').write_text(f'# {title}\n\n{sec}', encoding='utf-8')
        result['sections'] = len(sections)
    
    result['total_md'] = len(list(source_dir.glob('*.md')))
    return jsonify(result)

def safe_title(s):
    return s.strip()[:40].replace('/','_').replace('\\','_').replace(':','_').replace('*','_').replace('?','_') or 'untitled'

@app_flask.route('/api/archive/log', methods=['POST'])
def archive_log():
    data = request.json
    system = data.get('system', 'DND')
    adv = data.get('adventure', '默认')
    adv_dir = EXE_DIR / 'Ruler' / system / '存档' / adv
    adv_dir.mkdir(parents=True, exist_ok=True)
    log_file = adv_dir / 'conversation.txt'
    entry = f"[{data.get('time', '')}]\n玩家: {data.get('user', '')}\nGM: {data.get('ai', '')}\n\n"
    log_file.write_text(entry, encoding='utf-8')
    return jsonify({"success": True})

@app_flask.route('/api/archive/list')
def archive_list():
    ruler_dir = EXE_DIR / 'Ruler'
    if not ruler_dir.exists(): return jsonify([])
    advs = []
    for d in ruler_dir.iterdir():
        if d.is_dir():
            adir = d / '存档'
            if adir.exists():
                for a in adir.iterdir():
                    if a.is_dir():
                        files = [f.name for f in a.iterdir() if f.suffix in ('.txt', '.md')]
                        advs.append({"system": d.name, "name": a.name, "files": files})
    return jsonify(advs)

@app_flask.route('/api/module/search')
def module_search():
    q = request.args.get('q', '')
    system = request.args.get('system', '')
    ruler_dir = EXE_DIR / 'Ruler'
    results = []
    search_dirs = [ruler_dir / system / '模组'] if system else [ruler_dir / d / '模组' for d in ruler_dir.iterdir() if d.is_dir()]
    for mdir in search_dirs:
        if not mdir.exists(): continue
        for f in mdir.rglob('*'):
            if f.suffix in ('.md', '.txt') and f.is_file():
                try:
                    text = f.read_text(encoding='utf-8')
                    if q.lower() in text.lower():
                        results.append({
                            "title": f.stem[:60],
                            "type": "剧本",
                            "summary": text[:200],
                            "file": str(f.relative_to(mdir.parent))
                        })
                        if len(results) >= 10: break
                except: pass
    return jsonify({"results": results, "query": q})

@app_flask.route('/api/module/list')
def module_list():
    ruler_dir = EXE_DIR / 'Ruler'
    if not ruler_dir.exists(): return jsonify([])
    all_modules = []
    for d in ruler_dir.iterdir():
        if d.is_dir():
            mdir = d / '模组'
            if mdir.exists():
                for m in mdir.iterdir():
                    if m.is_dir():
                        files = [f.name for f in m.rglob('*') if f.is_file()]
                        all_modules.append({"system": d.name, "name": m.name, "files": len(files)})
    return jsonify(all_modules)

# ── 配置 ──
def config_path():
    return EXE_DIR / 'config.json'

def load_config():
    p = config_path()
    if p.exists():
        try: return json.loads(p.read_text())
        except: pass
    return {
        "ai": {
            "providers": {
                "gpt": {"name": "GPT", "endpoint": "https://api.openai.com/v1/chat/completions", "apiKey": "", "model": "gpt-4o", "enabled": False},
                "custom": {"name": "自定义API", "endpoint": "", "apiKey": "", "model": "", "enabled": False}
            },
            "activeProvider": "gpt"
        }
    }

@app_flask.route('/api/config', methods=['GET', 'POST'])
def config_api():
    if request.method == 'GET':
        cfg = load_config()
        for k, v in cfg.get('ai', {}).get('providers', {}).items():
            if v.get('apiKey'): v['apiKey'] = '***已设置***'
        return jsonify(cfg)
    else:
        data = request.json
        config_path().write_text(json.dumps(data, indent=2, ensure_ascii=False))
        return jsonify({"success": True})

@app_flask.route('/api/config/apikey', methods=['POST'])
def config_apikey():
    data = request.json
    cfg = load_config()
    if data['provider'] in cfg.get('ai', {}).get('providers', {}):
        cfg['ai']['providers'][data['provider']]['apiKey'] = data['apiKey']
        config_path().write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
        return jsonify({"success": True})
    return jsonify({"error": "未知提供商"}), 400

# ── 启动 ──
def start_server():
    # 确保规则书目录结构存在
    ruler = EXE_DIR / 'Ruler' / 'DND'
    for d in [ruler / 'compressed', ruler / 'source', ruler / '模组' / '默认' / '资源', ruler / '模组' / '默认' / '自定义', ruler / '存档' / '默认']:
        d.mkdir(parents=True, exist_ok=True)
    
    port = 3000
    print(f"[SoloTrpg] 启动服务 http://localhost:{port}")
    app_flask.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)

def start_gui():
    import webview
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    import time; time.sleep(0.5)
    webview.create_window('SoloTrpg', 'http://localhost:3000', width=1400, height=900, min_size=(900, 600))
    webview.start()

if __name__ == '__main__':
    start_gui()
