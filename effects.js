/**
 * effects.js - 场景特效（入场 / 环境叠加 / 浪漫组合 / 剧情冲击）
 * 约定：粒子素材别名 樱花、黄叶、红叶 需在资源库「粒子特效」注册；
 * 剧情冲击类特效默认播放同名音效（资源库「音效文件」别名与特效名一致）。
 */
const StoryEffectsRegistry = {
    /** 内置环境层（不需要粒子图文件） */
    BUILTIN_OVERLAY_IDS: new Set([
        'starryNight',
        'goldenBokeh',
        'softGlow',
        'heartBubbles',
        'rainFine',
        'coldBlue'
    ]),

    ENTRANCE: [
        { id: '', label: '（无）' },
        { id: 'dreamyFade', label: '1 梦幻渐显' },
        { id: 'glowExpand', label: '2 光晕扩散' },
        { id: 'mistRevealLR', label: '3 朦胧揭幕（左→右）' },
        { id: 'mistRevealTB', label: '3 朦胧揭幕（上→下）' },
        { id: 'heartbeat', label: '4 心跳缩放' },
        { id: 'kenBurns', label: '5 电影式推近' }
    ],
    OVERLAY_BUILTIN: [
        { id: 'starryNight', label: '7 星光闪烁' },
        { id: 'goldenBokeh', label: '8 金色光斑' },
        { id: 'softGlow', label: '9 柔光滤镜' },
        { id: 'heartBubbles', label: '10 心形气泡' },
        { id: 'rainFine', label: '细雨（思念等）' },
        { id: 'coldBlue', label: '蓝色冷色调（思念等）' }
    ],
    PARTICLE_PRESETS: [
        { id: '樱花', label: '樱花（粒子图）' },
        { id: '黄叶', label: '黄叶（粒子图）' },
        { id: '红叶', label: '红叶（粒子图）' }
    ],
    COMBO: [
        { id: '', label: '（无）' },
        { id: 'combo_firstMeet', label: '11 【初见】' },
        { id: 'combo_passionate', label: '12 【热恋】' },
        { id: 'combo_longing', label: '13 【思念】' }
    ],
    DRAMATIC: [
        { id: '', label: '（无）' },
        { id: '打击', label: '打击' },
        { id: '愤怒', label: '愤怒' },
        { id: '闪电', label: '闪电' },
        { id: '绝望', label: '绝望' },
        { id: '混乱', label: '混乱' },
        { id: '冰点', label: '冰点' },
        { id: '崩塌', label: '崩塌' }
    ],

    comboAssets(comboId) {
        const particles = new Set();
        const sounds = new Set();
        if (comboId === 'combo_passionate') particles.add('樱花');
        return { particles, sounds };
    },

    /** 资源导出：叠加层里非内置 id 的视为粒子别名（如 樱花 / 黄叶 / 红叶） */
    collectParticleAliasesFromSceneEffects(effects) {
        const ef = effects || {};
        const out = new Set();
        (ef.overlays || []).forEach(id => {
            if (id && !this.BUILTIN_OVERLAY_IDS.has(id)) out.add(id);
        });
        const ca = this.comboAssets(ef.combo || '');
        ca.particles.forEach(p => out.add(p));
        return out;
    },

    expandCombo(comboId) {
        if (!comboId) return { entrance: '', overlays: [], kenBurns: false };
        if (comboId === 'combo_firstMeet') {
            return {
                entrance: 'mistRevealLR',
                overlays: ['softGlow'],
                kenBurns: true,
                mistRevealDir: 'LR'
            };
        }
        if (comboId === 'combo_passionate') {
            return {
                entrance: 'heartbeat',
                overlays: ['樱花', 'goldenBokeh'],
                kenBurns: false
            };
        }
        if (comboId === 'combo_longing') {
            return {
                entrance: 'dreamyFade',
                overlays: ['coldBlue', 'rainFine'],
                kenBurns: true,
                kenBurnsSlow: true
            };
        }
        return { entrance: '', overlays: [], kenBurns: false };
    },

    normalizeEffects(raw) {
        const e = raw && typeof raw === 'object' ? raw : {};
        let overlays = Array.isArray(e.overlays) ? e.overlays.slice() : [];
        overlays = overlays.filter(Boolean);
        return {
            cgEntrance: e.cgEntrance != null ? String(e.cgEntrance) : '',
            overlays,
            combo: e.combo != null ? String(e.combo) : '',
            dramatic: e.dramatic != null ? String(e.dramatic) : ''
        };
    }
};

/** 编辑器「浪漫组合」中文名 → StoryEffectsRegistry.expandCombo 的 id */
const StepFxRomanticComboIdByLabel = {
    初见组合: 'combo_firstMeet',
    热恋组合: 'combo_passionate',
    如梦组合: 'combo_longing',
    星空誓言: 'combo_firstMeet',
    午后私语: 'combo_passionate',
    相拥时刻: 'combo_passionate',
    纯白告白: 'combo_firstMeet',
    枫林漫步: 'combo_firstMeet',
    雨后清晨: 'combo_longing',
    自动浪漫: 'combo_passionate'
};

/** 编辑器「浪漫入场」英文名 → _applyEntrance 的 id */
const StepFxEntranceIdByLabel = {
    'Dreamy Fade': 'dreamyFade',
    'Glow Expand': 'glowExpand',
    'Mist Reveal': 'mistRevealLR',
    'Heartbeat Scale': 'heartbeat',
    'Ken Burns In': 'kenBurns'
};

/** 编辑器「浪漫氛围」显示名 → 内置叠加 id 或粒子别名 */
const StepFxAmbientIdByLabel = {
    'Golden Bokeh': 'goldenBokeh',
    'Soft Glow': 'softGlow',
    'Heart Bubbles': 'heartBubbles',
    樱花: '樱花',
    黄叶: '黄叶',
    红叶: '红叶'
};

const StoryEffects = {
    _cleanups: [],
    _bgmAudio: null,
    _cgMusicAudio: null,
    _cgMusicFadeTimer: null,
    _loopingStepAudio: null,

    _addCleanup(fn) {
        if (typeof fn === 'function') this._cleanups.push(fn);
    },

    clear() {
        this.stopCgMusicOnly();
        this._cleanups.forEach(fn => {
            try {
                fn();
            } catch (err) {
                console.warn('effect cleanup', err);
            }
        });
        this._cleanups = [];

        const fx = document.getElementById('layer-fx');
        if (fx) fx.innerHTML = '';
        const sfx = document.getElementById('layer-screen-fx');
        if (sfx) sfx.innerHTML = '';

        const canvas = document.getElementById('game-canvas');
        if (canvas) {
            canvas.style.animation = '';
            canvas.style.transform = '';
            canvas.style.filter = '';
            canvas.classList.remove(
                'fx-shake',
                'fx-red-tint',
                'fx-grayscale',
                'fx-ice-blue',
                'fx-high-contrast'
            );
        }
    },

    /**
     * 步骤切换时清理「上一步」留下的入场/叠加/冲击视觉（不停止场景 BGM、不停止 CG 音乐）
     */
    cleanupStepVisualFx() {
        this._cleanups.forEach(fn => {
            try {
                fn();
            } catch (err) {
                console.warn('effect cleanup', err);
            }
        });
        this._cleanups = [];

        const fx = document.getElementById('layer-fx');
        if (fx) fx.innerHTML = '';
        const sfx = document.getElementById('layer-screen-fx');
        if (sfx) sfx.innerHTML = '';

        const canvas = document.getElementById('game-canvas');
        if (canvas) {
            canvas.style.animation = '';
            canvas.style.transform = '';
            canvas.style.filter = '';
            canvas.classList.remove(
                'fx-shake',
                'fx-red-tint',
                'fx-grayscale',
                'fx-ice-blue',
                'fx-high-contrast'
            );
        }
    },

    _resolveFxTargetMedia() {
        const storyLayer = document.getElementById('layer-story');
        const storyVisible = storyLayer && storyLayer.style.display !== 'none';
        if (storyVisible) {
            const img = storyLayer.querySelector('img');
            const vid = storyLayer.querySelector('video');
            const media = img || vid;
            if (media) {
                const wrap = media.parentElement && media.parentElement !== document.body ? media.parentElement : storyLayer;
                return { media, wrap };
            }
        }
        const bgLayer = document.getElementById('layer-bg');
        const bgImg = bgLayer && bgLayer.querySelector('img');
        if (bgImg) return { media: bgImg, wrap: bgLayer };
        return { media: null, wrap: null };
    },

    /**
     * 运行「步骤 · 特效音效」里配置的浪漫组合/入场/氛围（与编辑器 step.stepFx 一致）
     */
    applyStepFx(step) {
        if (!step || typeof step !== 'object') return;
        const fx = step.stepFx;
        if (!fx || typeof fx !== 'object') return;
        const rom = fx.romantic && typeof fx.romantic === 'object' ? fx.romantic : {};
        const comboLabel = (rom.combo && String(rom.combo).trim()) || '';
        const entryLabel = (rom.entry && String(rom.entry).trim()) || '';
        const ambientLabel = (rom.ambient && String(rom.ambient).trim()) || '';

        if (!comboLabel && !entryLabel && !ambientLabel) return;

        const { media, wrap } = this._resolveFxTargetMedia();

        let entrance = '';
        let overlays = [];
        let expanded = { kenBurns: false, kenBurnsSlow: false, mistRevealDir: 'LR' };

        if (comboLabel) {
            const comboId = StepFxRomanticComboIdByLabel[comboLabel] || '';
            if (comboId) {
                expanded = StoryEffectsRegistry.expandCombo(comboId);
                entrance = expanded.entrance || '';
                overlays = Array.isArray(expanded.overlays) ? expanded.overlays.slice() : [];
            }
        } else {
            if (entryLabel) {
                entrance = StepFxEntranceIdByLabel[entryLabel] || '';
            }
            if (ambientLabel) {
                const oid = StepFxAmbientIdByLabel[ambientLabel] || ambientLabel;
                if (oid) overlays.push(oid);
            }
        }

        overlays.forEach(id => {
            if (id) this._startOverlay(id);
        });

        const wantKenBurns =
            Boolean(expanded && expanded.kenBurns) || (!comboLabel && entrance === 'kenBurns');

        if (media && wrap) {
            if (entrance === 'kenBurns') {
                this._applyKenBurns(media, expanded);
            } else if (entrance) {
                this._applyEntrance(entrance, media, wrap, expanded);
            }

            if (wantKenBurns && entrance !== 'kenBurns') {
                let delay = 220;
                if (entrance === 'mistRevealLR' || entrance === 'mistRevealTB') delay = 1250;
                else if (entrance === 'dreamyFade') delay = 450;
                else if (entrance === 'heartbeat') delay = 960;
                else if (entrance === 'glowExpand') delay = 560;
                else if (!entrance) delay = 60;
                const t = window.setTimeout(() => this._applyKenBurns(media, expanded), delay);
                this._addCleanup(() => clearTimeout(t));
            }
        }
    },

    playSound(alias, opts = {}) {
        if (!alias || typeof AssetManager === 'undefined' || !AssetManager.getPath) return;
        const path = AssetManager.getPath('sounds', alias);
        if (!path) return;
        try {
            if (opts && opts.loop) {
                this.stopLoopingStepSound();
            }
            const a = new Audio(path);
            if (opts && opts.loop) {
                a.loop = true;
                this._loopingStepAudio = a;
            }
            a.play().catch(() => {});
        } catch (err) {
            console.warn('playSound', alias, err);
        }
    },

    stopLoopingStepSound() {
        if (!this._loopingStepAudio) return;
        try {
            this._loopingStepAudio.pause();
            this._loopingStepAudio.currentTime = 0;
        } catch {}
        this._loopingStepAudio = null;
    },

    playMusicForScene(scene) {
        const alias = scene && scene.music && scene.music.url ? scene.music.url : '';
        const loop = !(scene && scene.music && scene.music.loop === false);
        if (!alias || typeof AssetManager === 'undefined' || !AssetManager.getPath) {
            this.stopMusic();
            return;
        }
        const path = AssetManager.getPath('music', alias);
        if (!path) {
            this.stopMusic();
            return;
        }
        if (this._bgmAudio && this._bgmAudio.dataset && this._bgmAudio.dataset.srcAlias === alias && this._bgmAudio.loop === loop) {
            return;
        }
        this.stopMusic();
        try {
            const a = new Audio(path);
            a.loop = loop;
            a.dataset.srcAlias = alias;
            a.volume = 0.9;
            a.play().catch(() => {});
            this._bgmAudio = a;
        } catch (err) {
            console.warn('playMusicForScene', alias, err);
        }
    },

    stopMusic() {
        if (!this._bgmAudio) return;
        try {
            this._bgmAudio.pause();
            this._bgmAudio.currentTime = 0;
        } catch {}
        this._bgmAudio = null;
    },

    _cancelCgMusicFade() {
        if (this._cgMusicFadeTimer) {
            clearInterval(this._cgMusicFadeTimer);
            this._cgMusicFadeTimer = null;
        }
    },

    /** 仅停止 CG 专属音乐（不恢复场景 BGM） */
    stopCgMusicOnly() {
        this._cancelCgMusicFade();
        if (!this._cgMusicAudio) return;
        try {
            this._cgMusicAudio.pause();
            this._cgMusicAudio.currentTime = 0;
        } catch {}
        this._cgMusicAudio = null;
    },

    /**
     * CG 步骤专属音乐（来自资源库「背景音乐」别名）；播放时会停掉场景 BGM
     */
    playCgMusic(alias, loop = true) {
        if (!alias || typeof AssetManager === 'undefined' || !AssetManager.getPath) return;
        const path = AssetManager.getPath('music', alias);
        if (!path) return;
        this.stopCgMusicOnly();
        this.stopMusic();
        try {
            const a = new Audio(path);
            a.loop = !!loop;
            a.volume = 0.95;
            a.play().catch(() => {});
            this._cgMusicAudio = a;
        } catch (err) {
            console.warn('playCgMusic', alias, err);
        }
    },

    /**
     * 停止 CG 音乐并恢复场景 BGM（进入「停止音乐」步时调用）
     * @param {object} scene
     * @param {number} fadeMs 淡出毫秒数，默认约 0.65s
     */
    stopCgMusicResumeBgm(scene, fadeMs = 650) {
        this._cancelCgMusicFade();
        const a = this._cgMusicAudio;
        if (!a) {
            if (typeof this.playMusicForScene === 'function') this.playMusicForScene(scene);
            return;
        }
        if (!fadeMs || fadeMs <= 0) {
            try {
                a.pause();
                a.currentTime = 0;
            } catch {}
            this._cgMusicAudio = null;
            if (typeof this.playMusicForScene === 'function') this.playMusicForScene(scene);
            return;
        }
        const startVol = typeof a.volume === 'number' ? a.volume : 0.95;
        const ticks = Math.max(8, Math.ceil(fadeMs / 55));
        const dt = Math.max(35, Math.floor(fadeMs / ticks));
        let n = 0;
        this._cgMusicFadeTimer = setInterval(() => {
            n++;
            try {
                a.volume = Math.max(0, startVol * (1 - n / ticks));
            } catch {}
            if (n >= ticks) {
                this._cancelCgMusicFade();
                try {
                    a.pause();
                    a.currentTime = 0;
                } catch {}
                this._cgMusicAudio = null;
                if (typeof this.playMusicForScene === 'function') this.playMusicForScene(scene);
            }
        }, dt);
    },

    /**
     * @param {object} scene
     * @param {{ storyImg?: HTMLImageElement|null, storyWrap?: HTMLElement|null }} ctx
     */
    runForScene(scene, ctx = {}) {
        this.clear();
        const ef = StoryEffectsRegistry.normalizeEffects(scene && scene.effects);
        const expanded = StoryEffectsRegistry.expandCombo(ef.combo);

        const entrance = ef.combo ? expanded.entrance : ef.cgEntrance;
        const overlays = ef.combo ? expanded.overlays : ef.overlays;

        const storyImg = ctx.storyImg || null;
        const storyWrap = ctx.storyWrap || null;

        overlays.forEach(id => this._startOverlay(id));

        const wantKenBurns =
            Boolean(expanded && expanded.kenBurns) ||
            (!ef.combo && ef.cgEntrance === 'kenBurns');

        if (storyImg && storyWrap) {
            if (entrance === 'kenBurns') {
                this._applyKenBurns(storyImg, expanded);
            } else if (entrance) {
                this._applyEntrance(entrance, storyImg, storyWrap, expanded);
            }

            if (wantKenBurns && entrance !== 'kenBurns') {
                let delay = 220;
                if (entrance === 'mistRevealLR' || entrance === 'mistRevealTB') delay = 1250;
                else if (entrance === 'dreamyFade') delay = 450;
                else if (entrance === 'heartbeat') delay = 960;
                else if (entrance === 'glowExpand') delay = 560;
                else if (!entrance) delay = 60;
                const t = window.setTimeout(() => this._applyKenBurns(storyImg, expanded), delay);
                this._addCleanup(() => clearTimeout(t));
            }
        }

        if (ef.dramatic) {
            this._runDramatic(ef.dramatic);
        }
    },

    _applyEntrance(id, img, wrap, expanded) {
        const w = wrap;
        const el = img;
        if (id === 'dreamyFade') {
            el.style.opacity = '0';
            el.style.filter = 'blur(14px)';
            el.style.transition = 'opacity 1.1s ease-out, filter 1.2s ease-out';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                    el.style.filter = 'blur(0)';
                });
            });
            this._addCleanup(() => {
                el.style.transition = '';
                el.style.filter = '';
                el.style.opacity = '';
            });
            return;
        }
        if (id === 'glowExpand') {
            el.style.opacity = '0';
            el.style.transform = 'scale(0.35)';
            el.style.filter = 'brightness(2.8)';
            el.style.transition = 'opacity 0.95s ease-out, transform 1s cubic-bezier(0.2, 0.9, 0.2, 1), filter 1s ease-out';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                    el.style.transform = 'scale(1)';
                    el.style.filter = 'brightness(1)';
                });
            });
            const pulse = document.createElement('div');
            pulse.className = 'fx-glow-pulse';
            w.appendChild(pulse);
            const t = window.setTimeout(() => pulse.remove(), 1100);
            this._addCleanup(() => {
                window.clearTimeout(t);
                pulse.remove();
                el.style.transition = '';
                el.style.transform = '';
                el.style.filter = '';
                el.style.opacity = '';
            });
            return;
        }
        if (id === 'mistRevealLR' || id === 'mistRevealTB') {
            const vertical = id === 'mistRevealTB';
            w.style.overflow = 'hidden';
            el.style.clipPath = vertical ? 'inset(100% 0 0 0)' : 'inset(0 100% 0 0)';
            el.style.transition = 'clip-path 1.15s cubic-bezier(0.4, 0, 0.2, 1)';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    el.style.clipPath = 'inset(0 0 0 0)';
                });
            });
            this._addCleanup(() => {
                el.style.transition = '';
                el.style.clipPath = '';
                w.style.overflow = '';
            });
            return;
        }
        if (id === 'heartbeat') {
            el.style.animation = 'fx-heartbeat 0.85s ease-out 1';
            this._addCleanup(() => {
                el.style.animation = '';
            });
            return;
        }
    },

    _applyKenBurns(el, expanded) {
        const slow = expanded && expanded.kenBurnsSlow;
        const dur = slow ? 38 : 22;
        el.style.transformOrigin = '50% 50%';
        el.style.transition = `transform ${dur}s linear`;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                el.style.transform = 'scale(1.09)';
            });
        });
        this._addCleanup(() => {
            el.style.transition = '';
            el.style.transform = '';
            el.style.transformOrigin = '';
        });
    },

    _startOverlay(id) {
        const builtin = {
            starryNight: () => this._overlayStarryNight(),
            goldenBokeh: () => this._overlayGoldenBokeh(),
            softGlow: () => this._overlaySoftGlow(),
            heartBubbles: () => this._overlayHeartBubbles(),
            rainFine: () => this._overlayRainFine(),
            coldBlue: () => this._overlayColdBlue()
        };
        if (builtin[id]) {
            builtin[id]();
            return;
        }
        this._overlayParticleAlias(id);
    },

    _ensureFxLayer() {
        return document.getElementById('layer-fx');
    },

    _overlayStarryNight() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-starry-night';
        for (let i = 0; i < 48; i++) {
            const s = document.createElement('span');
            s.className = 'fx-star';
            s.style.left = `${Math.random() * 100}%`;
            s.style.top = `${Math.random() * 100}%`;
            s.style.animationDelay = `${Math.random() * 4}s`;
            holder.appendChild(s);
        }
        layer.appendChild(holder);
    },

    _overlayGoldenBokeh() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-bokeh';
        const positions = [
            { l: '2%', t: '20%', w: 120, h: 120 },
            { l: '78%', t: '10%', w: 160, h: 160 },
            { l: '85%', t: '55%', w: 100, h: 100 },
            { l: '5%', t: '65%', w: 140, h: 140 },
            { l: '45%', t: '3%', w: 90, h: 90 }
        ];
        positions.forEach(p => {
            const d = document.createElement('div');
            d.className = 'fx-bokeh-dot';
            d.style.left = p.l;
            d.style.top = p.t;
            d.style.width = `${p.w}px`;
            d.style.height = `${p.h}px`;
            d.style.animationDelay = `${Math.random() * 3}s`;
            holder.appendChild(d);
        });
        layer.appendChild(holder);
    },

    _overlaySoftGlow() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const g = document.createElement('div');
        g.className = 'fx-overlay fx-soft-glow';
        layer.appendChild(g);
    },

    _overlayHeartBubbles() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-heart-bubbles';
        for (let i = 0; i < 7; i++) {
            const h = document.createElement('div');
            h.className = 'fx-heart';
            h.style.left = `${10 + i * 12 + Math.random() * 8}%`;
            h.style.animationDelay = `${i * 0.6 + Math.random()}s`;
            h.style.fontSize = `${14 + Math.random() * 10}px`;
            holder.appendChild(h);
        }
        layer.appendChild(holder);
    },

    _overlayRainFine() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const c = document.createElement('canvas');
        c.className = 'fx-overlay fx-rain-canvas';
        c.width = 1280;
        c.height = 720;
        layer.appendChild(c);
        const ctx = c.getContext('2d');
        const drops = [];
        for (let i = 0; i < 140; i++) {
            drops.push({
                x: Math.random() * c.width,
                y: Math.random() * c.height,
                len: 10 + Math.random() * 18,
                speed: 1.2 + Math.random() * 2.4,
                drift: -0.4 + Math.random() * 0.8
            });
        }
        let raf = 0;
        const tick = () => {
            if (!c.isConnected) return;
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.strokeStyle = 'rgba(200, 220, 255, 0.35)';
            ctx.lineWidth = 1;
            drops.forEach(d => {
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x + d.drift * 6, d.y + d.len);
                ctx.stroke();
                d.y += d.speed;
                d.x += d.drift;
                if (d.y > c.height) {
                    d.y = -10;
                    d.x = Math.random() * c.width;
                }
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        this._addCleanup(() => cancelAnimationFrame(raf));
    },

    _overlayColdBlue() {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const d = document.createElement('div');
        d.className = 'fx-overlay fx-cold-blue';
        layer.appendChild(d);
    },

    _overlayParticleAlias(alias) {
        const layer = this._ensureFxLayer();
        if (!layer) return;
        const path =
            typeof AssetManager !== 'undefined' && AssetManager.getPath
                ? AssetManager.getPath('particles', alias)
                : null;
        if (!path) {
            console.warn('粒子特效未注册:', alias);
            return;
        }
        const holder = document.createElement('div');
        holder.className = 'fx-overlay fx-particle-fall';
        const pieces = 26;
        let raf = 0;
        const items = [];
        for (let i = 0; i < pieces; i++) {
            const img = document.createElement('img');
            img.src = path;
            img.className = 'fx-particle-img';
            img.draggable = false;
            const scale = 0.35 + Math.random() * 0.55;
            const item = {
                el: img,
                x: Math.random() * 1280,
                y: -40 - Math.random() * 720,
                vx: -0.8 + Math.random() * 1.6,
                vy: 0.8 + Math.random() * 1.8,
                rot: Math.random() * Math.PI * 2,
                vr: (-0.02 + Math.random() * 0.04) * scale,
                sc: scale
            };
            img.style.width = `${42 * scale}px`;
            holder.appendChild(img);
            items.push(item);
        }
        layer.appendChild(holder);
        const tick = () => {
            if (!holder.isConnected) return;
            items.forEach(it => {
                it.x += it.vx + Math.sin(it.y * 0.01) * 0.35;
                it.y += it.vy;
                it.rot += it.vr;
                if (it.y > 760) {
                    it.y = -30 - Math.random() * 100;
                    it.x = Math.random() * 1280;
                }
                if (it.x < -60) it.x = 1280;
                if (it.x > 1340) it.x = -40;
                it.el.style.transform = `translate(${it.x}px, ${it.y}px) rotate(${it.rot}rad)`;
                it.el.style.opacity = String(0.55 + Math.sin(it.y * 0.05) * 0.15);
            });
            raf = requestAnimationFrame(tick);
        };
        tick();
        this._addCleanup(() => cancelAnimationFrame(raf));
    },

    _screenLayer() {
        return document.getElementById('layer-screen-fx');
    },

    _runDramatic(name, opts = {}) {
        if (!opts || !opts.muteSound) this.playSound(name);
        const canvas = document.getElementById('game-canvas');
        const screen = this._screenLayer();
        if (!canvas) return;

        const shake = (durMs, intensity = 6) => {
            const start = performance.now();
            let raf = 0;
            const step = now => {
                const t = now - start;
                if (t > durMs) {
                    canvas.style.transform = '';
                    return;
                }
                const decay = 1 - t / durMs;
                const x = (Math.random() - 0.5) * 2 * intensity * decay;
                const y = (Math.random() - 0.5) * 2 * intensity * decay;
                canvas.style.transform = `translate(${x}px, ${y}px)`;
                raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);
            this._addCleanup(() => {
                cancelAnimationFrame(raf);
                canvas.style.transform = '';
            });
        };

        if (name === '打击') {
            const flash = document.createElement('div');
            flash.className = 'fx-flash-white';
            screen.appendChild(flash);
            window.setTimeout(() => flash.remove(), 220);
            canvas.style.transition = 'transform 0.12s ease-out';
            canvas.style.transform = 'scale(0.94)';
            window.setTimeout(() => {
                canvas.style.transform = 'scale(1)';
                shake(420, 10);
            }, 90);
            this._addCleanup(() => {
                canvas.style.transition = '';
                flash.remove();
            });
            return;
        }

        if (name === '愤怒') {
            canvas.classList.add('fx-red-tint');
            shake(900, 3.5);
            const vig = document.createElement('div');
            vig.className = 'fx-vignette-red';
            screen.appendChild(vig);
            this._addCleanup(() => {
                canvas.classList.remove('fx-red-tint');
                vig.remove();
            });
            return;
        }

        if (name === '闪电') {
            let flashes = 0;
            const iv = window.setInterval(() => {
                flashes++;
                const flash = document.createElement('div');
                flash.className = flashes % 2 === 0 ? 'fx-flash-white' : 'fx-flash-dark';
                flash.style.opacity = flashes % 2 === 0 ? '0.92' : '0.55';
                screen.appendChild(flash);
                window.setTimeout(() => flash.remove(), 45);
                canvas.classList.toggle('fx-high-contrast', flashes % 2 === 1);
                if (flashes >= 6) {
                    window.clearInterval(iv);
                    canvas.classList.remove('fx-high-contrast');
                }
            }, 55);
            this._addCleanup(() => {
                window.clearInterval(iv);
                canvas.classList.remove('fx-high-contrast');
            });
            return;
        }

        if (name === '绝望') {
            canvas.classList.add('fx-grayscale');
            canvas.style.transition = 'transform 2.8s ease-in, filter 2.8s ease-in';
            canvas.style.transform = 'scale(0.88)';
            const fog = document.createElement('div');
            fog.className = 'fx-edge-fog';
            screen.appendChild(fog);
            this._addCleanup(() => {
                canvas.classList.remove('fx-grayscale');
                canvas.style.transition = '';
                canvas.style.transform = '';
                fog.remove();
            });
            return;
        }

        if (name === '混乱') {
            let t0 = performance.now();
            let raf = 0;
            const loop = now => {
                const t = now - t0;
                if (t > 2200) {
                    canvas.style.filter = '';
                    canvas.style.transform = '';
                    return;
                }
                const phase = Math.floor(t / 90) % 2;
                canvas.style.filter = phase ? 'invert(1) contrast(1.15)' : 'contrast(1.25)';
                canvas.style.transform = `translate(${(Math.random() - 0.5) * 14}px, ${(Math.random() - 0.5) * 12}px)`;
                raf = requestAnimationFrame(loop);
            };
            raf = requestAnimationFrame(loop);
            this._addCleanup(() => {
                cancelAnimationFrame(raf);
                canvas.style.filter = '';
                canvas.style.transform = '';
            });
            return;
        }

        if (name === '冰点') {
            canvas.classList.add('fx-ice-blue');
            const frost = document.createElement('div');
            frost.className = 'fx-frost-frame';
            screen.appendChild(frost);
            window.setTimeout(() => frost.classList.add('fx-frost-out'), 380);
            window.setTimeout(() => {
                frost.remove();
                canvas.classList.remove('fx-ice-blue');
            }, 1400);
            this._addCleanup(() => {
                frost.remove();
                canvas.classList.remove('fx-ice-blue');
            });
            return;
        }

        if (name === '崩塌') {
            shake(700, 12);
            const crack = document.createElement('div');
            crack.className = 'fx-shatter';
            screen.appendChild(crack);
            window.setTimeout(() => crack.remove(), 900);
            this._addCleanup(() => crack.remove());
        }
    }
};
