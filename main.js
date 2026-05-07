/**
 * main.js - 初始化与引导逻辑
 */
window.addEventListener('load', () => {
    initResponsiveCanvas();
    window.addEventListener('resize', initResponsiveCanvas);
    initBootProcess();
});

function initResponsiveCanvas() {
    const viewport = document.getElementById('game-viewport');
    if (!viewport) return;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const gameWidth = 1280;
    const gameHeight = 720;
    const ratio = gameWidth / gameHeight;
    let scale = Math.min(windowWidth / gameWidth, windowHeight / gameHeight, 1);
    viewport.style.width = `${gameWidth * scale}px`;
    viewport.style.height = `${gameHeight * scale}px`;
    viewport.style.transform = `scale(${scale})`;
}

function initBootProcess() {
    const btnSelect = document.getElementById('btn-select-file');
    const fileInput = document.getElementById('project-upload');
    const bootScreen = document.getElementById('boot-screen');
    const gameViewport = document.getElementById('game-viewport');

    const startGame = (data) => {
        // 隐藏引导界面，显示游戏
        bootScreen.style.display = 'none';
        gameViewport.style.display = 'block';
        if (typeof GameState !== 'undefined' && GameState.initCharacterState) {
            GameState.initCharacterState(data);
        }
        Renderer.init(data);
    };

    const tryLoadByFetch = async () => {
        const res = await fetch('episode.json');
        if (!res.ok) {
            throw new Error(`fetch 无法读取 episode.json (${res.status})`);
        }
        return await res.json();
    };

    const tryLoadByXHR = async () => {
        return await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'episode.json', true);
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                if (xhr.status === 200 || xhr.status === 0) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (err) {
                        reject(new Error('XHR 读取成功但 JSON 解析失败'));
                    }
                    return;
                }
                reject(new Error(`XHR 无法读取 episode.json (${xhr.status})`));
            };
            xhr.onerror = () => reject(new Error('XHR 读取 episode.json 失败'));
            xhr.send();
        });
    };

    const tryLoadByFs = async () => {
        if (typeof window.require !== 'function') {
            throw new Error('当前环境不支持 window.require');
        }
        const fs = window.require('fs');
        const path = window.require('path');
        const baseDir = decodeURIComponent(window.location.pathname).replace(/^\/([a-zA-Z]:\/)/, '$1');
        const jsonPath = path.join(path.dirname(baseDir), 'episode.json');
        const text = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(text);
    };

    const tryAutoLoadDefaultProject = async () => {
        try {
            let data = null;
            try {
                data = await tryLoadByFetch();
            } catch (fetchErr) {
                try {
                    data = await tryLoadByXHR();
                } catch (xhrErr) {
                    data = await tryLoadByFs();
                }
            }
            startGame(data);
        } catch (err) {
            // 自动加载失败时保留手动选择入口，不阻断游玩。
            console.warn('自动加载 episode.json 失败，切换为手动选择：', err);
            bootScreen.style.display = 'flex';
            gameViewport.style.display = 'none';
        }
    };

    btnSelect.onclick = () => fileInput.click();

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await StorageManager.loadProjectFile(file);
            startGame(data);
        } catch (err) {
            alert("项目加载失败: " + err);
        }
    };

    tryAutoLoadDefaultProject();
}
