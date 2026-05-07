/**
 * debug-runtime.js - 调试页专用：属性监视面板 + 固定随机种子设置
 * 仅在 index_debug.html 引入。
 */
(function () {
    if (typeof GameState === 'undefined') return;

    // 调试页默认启用固定种子（可在面板里关闭）
    GameState.runtimeConfig.fixedSeed = true;
    GameState.runtimeConfig.publishMode = false;
    if (!Number.isFinite(Number(GameState.runtimeConfig.seed))) GameState.runtimeConfig.seed = 12345;

    const css = document.createElement('style');
    css.textContent = `
    #debug-drawer {
        position: fixed;
        right: 12px;
        top: 12px;
        width: 360px;
        max-height: calc(100vh - 24px);
        z-index: 9999;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 12px;
        background: rgba(20,20,20,0.88);
        color: #eee;
        backdrop-filter: blur(10px);
        overflow: hidden;
        font-family: "Microsoft YaHei", system-ui, sans-serif;
    }
    #debug-drawer.collapsed { width: 120px; }
    #debug-head {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:10px 10px;
        background: rgba(0,0,0,0.35);
        border-bottom: 1px solid rgba(255,255,255,0.12);
    }
    #debug-body { padding: 10px; overflow:auto; max-height: calc(100vh - 80px); }
    #debug-drawer button, #debug-drawer input, #debug-drawer select {
        font-size: 12px;
    }
    #debug-drawer button {
        background: rgba(255,255,255,0.12);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 8px;
        padding: 4px 8px;
        cursor: pointer;
    }
    #debug-drawer input {
        width: 100%;
        box-sizing: border-box;
        background: rgba(255,255,255,0.08);
        color:#fff;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 8px;
        padding: 5px 8px;
        outline: none;
    }
    .dbg-row { display:flex; gap:8px; align-items:center; margin-bottom: 8px; }
    .dbg-row label { width: 86px; color:#bcd; opacity:0.9; }
    .dbg-title { font-weight:700; letter-spacing:0.4px; }
    .dbg-sub { color:#bbb; font-size: 12px; margin: 8px 0; }
    .dbg-kv { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
    .dbg-log { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; white-space: pre-wrap; color:#ddd; }
    .dbg-pill { display:inline-block; padding:2px 6px; border-radius:999px; background: rgba(140,200,255,0.12); border:1px solid rgba(140,200,255,0.18); font-size: 11px; }
    `;
    document.head.appendChild(css);

    const drawer = document.createElement('div');
    drawer.id = 'debug-drawer';

    const head = document.createElement('div');
    head.id = 'debug-head';
    const title = document.createElement('div');
    title.innerHTML = `<span class="dbg-title">🧪 Debug</span> <span class="dbg-pill">隐藏属性</span>`;
    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '6px';
    const btnCollapse = document.createElement('button');
    btnCollapse.textContent = '收起';
    btnCollapse.onclick = () => {
        const c = drawer.classList.toggle('collapsed');
        btnCollapse.textContent = c ? '展开' : '收起';
        body.style.display = c ? 'none' : 'block';
    };
    const btnCopy = document.createElement('button');
    btnCopy.textContent = '复制';
    btnCopy.onclick = async () => {
        const txt = buildSnapshotText();
        try {
            await navigator.clipboard.writeText(txt);
        } catch {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = txt;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    };
    btns.appendChild(btnCopy);
    btns.appendChild(btnCollapse);
    head.appendChild(title);
    head.appendChild(btns);

    const body = document.createElement('div');
    body.id = 'debug-body';

    const seedRow = document.createElement('div');
    seedRow.className = 'dbg-row';
    const seedLabel = document.createElement('label');
    seedLabel.textContent = '随机 seed';
    const seedInp = document.createElement('input');
    seedInp.value = String(GameState.runtimeConfig.seed || 12345);
    seedInp.onchange = () => {
        const v = Number(seedInp.value);
        if (Number.isFinite(v)) {
            GameState.setSeed(v);
        }
    };
    seedRow.appendChild(seedLabel);
    seedRow.appendChild(seedInp);

    const fixedRow = document.createElement('div');
    fixedRow.className = 'dbg-row';
    const fixedLabel = document.createElement('label');
    fixedLabel.textContent = '固定种子';
    const fixedBtn = document.createElement('button');
    const refreshFixed = () => {
        fixedBtn.textContent = GameState.runtimeConfig.fixedSeed ? '已开启（点关闭）' : '已关闭（点开启）';
    };
    fixedBtn.onclick = () => {
        GameState.runtimeConfig.fixedSeed = !GameState.runtimeConfig.fixedSeed;
        refreshFixed();
    };
    refreshFixed();
    fixedRow.appendChild(fixedLabel);
    fixedRow.appendChild(fixedBtn);

    const sceneRow = document.createElement('div');
    sceneRow.className = 'dbg-sub';
    sceneRow.id = 'dbg-scene';
    sceneRow.textContent = '未开始';

    const varsTitle = document.createElement('div');
    varsTitle.className = 'dbg-sub';
    varsTitle.textContent = '变量（旧）';
    const varsBox = document.createElement('div');
    varsBox.className = 'dbg-kv';

    const charsTitle = document.createElement('div');
    charsTitle.className = 'dbg-sub';
    charsTitle.textContent = '角色属性';
    const charsBox = document.createElement('div');
    charsBox.className = 'dbg-kv';

    const logTitle = document.createElement('div');
    logTitle.className = 'dbg-sub';
    logTitle.textContent = '最近变更';
    const logBox = document.createElement('div');
    logBox.className = 'dbg-log';

    body.appendChild(seedRow);
    body.appendChild(fixedRow);
    body.appendChild(sceneRow);
    body.appendChild(varsTitle);
    body.appendChild(varsBox);
    body.appendChild(charsTitle);
    body.appendChild(charsBox);
    body.appendChild(logTitle);
    body.appendChild(logBox);

    drawer.appendChild(head);
    drawer.appendChild(body);
    document.body.appendChild(drawer);

    function buildSnapshotText() {
        const lines = [];
        lines.push(`[Scene] ${window.SceneManager ? SceneManager.currentSceneId : ''}  step=${window.SceneManager ? SceneManager.currentStepIndex : ''}`);
        lines.push(`[Seed] fixed=${GameState.runtimeConfig.fixedSeed} seed=${GameState.runtimeConfig.seed}`);
        lines.push('');
        lines.push('[Vars]');
        Object.keys(GameState.variables || {}).forEach(k => lines.push(`${k}=${JSON.stringify(GameState.variables[k])}`));
        lines.push('');
        lines.push('[Characters]');
        Object.keys(GameState.characters || {}).forEach(cid => {
            const c = GameState.characters[cid];
            lines.push(`${cid}:`);
            lines.push(`  unified=${JSON.stringify(c.unified || {})}`);
            lines.push(`  relations=${JSON.stringify(c.relations || {})}`);
        });
        lines.push('');
        lines.push('[Log]');
        (GameState.debugLog || []).slice(-50).forEach(x => lines.push(JSON.stringify(x)));
        return lines.join('\n');
    }

    function render() {
        const sceneId = window.SceneManager ? SceneManager.currentSceneId : '';
        const stepIdx = window.SceneManager ? SceneManager.currentStepIndex : '';
        const step = window.SceneManager && SceneManager.getCurrentStep ? SceneManager.getCurrentStep() : null;
        sceneRow.textContent = `场景：${sceneId}   步骤：${stepIdx}${step && step.type ? `   类型：${step.type}` : ''}`;

        const vars = GameState.variables || {};
        varsBox.textContent = Object.keys(vars)
            .map(k => `${k}: ${JSON.stringify(vars[k])}`)
            .join('\n');

        const chars = GameState.characters || {};
        const parts = [];
        Object.keys(chars).forEach(cid => {
            const c = chars[cid] || {};
            const uni = c.unified || {};
            const rel = c.relations || {};
            parts.push(`${cid}`);
            const uniKeys = Object.keys(uni);
            if (uniKeys.length) {
                parts.push(`  统一: ${uniKeys.map(k => `${k}=${uni[k]}`).join(' , ')}`);
            }
            const relKeys = Object.keys(rel);
            if (relKeys.length) {
                parts.push(`  关系:`);
                relKeys.forEach(tid => {
                    const a = rel[tid] ? rel[tid].affection : 0;
                    parts.push(`    -> ${tid} 好感=${a}`);
                });
            }
        });
        charsBox.textContent = parts.join('\n');

        const logs = (GameState.debugLog || []).slice(-28);
        logBox.textContent = logs
            .map(l => {
                const tm = new Date(l.t).toLocaleTimeString();
                if (l.type === 'relation') {
                    const d = l.detail;
                    return `${tm} [关系] ${d.from} -> ${d.to} ${d.prev}→${d.next} (Δ${d.delta})`;
                }
                if (l.type === 'unified') {
                    const d = l.detail;
                    return `${tm} [统一] ${d.charId}.${d.key} ${JSON.stringify(d.prev)}→${JSON.stringify(d.next)}`;
                }
                if (l.type === 'var') {
                    const d = l.detail;
                    return `${tm} [变量] ${d.key}=${JSON.stringify(d.value)}`;
                }
                return `${tm} ${l.type}: ${JSON.stringify(l.detail)}`;
            })
            .join('\n');
    }

    setInterval(render, 250);
})();

