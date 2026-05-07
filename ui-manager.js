/**
 * ui-manager.js - 界面显示管理器
 */
const UIManager = {
    currentPage: 0,
    pages: [],
    _stepId: '',

    _measureCtx() {
        const c = UIManager._measureCanvas || (UIManager._measureCanvas = document.createElement('canvas'));
        const ctx = c.getContext('2d');
        const el = document.getElementById('text-content');
        const style = el ? window.getComputedStyle(el) : null;
        const font = style ? `${style.fontWeight} ${style.fontSize} ${style.fontFamily}` : '22px sans-serif';
        ctx.font = font;
        return ctx;
    },

    _wrapToVisualLines(text, maxWidthPx) {
        const ctx = this._measureCtx();
        const raw = String(text || '').replace(/\r\n/g, '\n');
        const logicalLines = raw.split('\n');
        const out = [];

        const pushWrapped = (line) => {
            const s = String(line || '');
            if (!s) {
                out.push('');
                return;
            }
            let cur = '';
            for (let i = 0; i < s.length; i++) {
                const ch = s[i];
                const next = cur + ch;
                if (ctx.measureText(next).width > maxWidthPx && cur) {
                    out.push(cur);
                    cur = ch;
                } else {
                    cur = next;
                }
            }
            if (cur) out.push(cur);
        };

        logicalLines.forEach(l => pushWrapped(l));
        return out;
    },

    splitTextIntoPagesBy3Lines(text) {
        // 按“作者输入的逻辑换行”分页，不在一句话中间自动折断
        const raw = String(text || '').replace(/\r\n/g, '\n');
        const lines = raw.split('\n');
        // 防止尾部不可见空行被分页成“下一页空白框”
        while (lines.length > 1 && String(lines[lines.length - 1] || '').trim() === '') {
            lines.pop();
        }
        const pages = [];
        for (let i = 0; i < lines.length; i += 3) {
            pages.push(lines.slice(i, i + 3).join('\n'));
        }
        return pages.length ? pages : [''];
    },

    showTextStep(scene, step, persistentCgStep = null) {
        this._stepId = step && step.id ? step.id : '';
        const nameEl = document.getElementById('char-name');
        const speakerName = this._resolveSpeakerName(scene, step);
        nameEl.textContent = speakerName || '';
        nameEl.style.display = speakerName ? 'block' : 'none';
        nameEl.style.fontWeight = step && step.type === 'narration' ? '700' : '';

        const finalText = GameState.parseText(step && step.text ? step.text : '');
        this.pages = this.splitTextIntoPagesBy3Lines(finalText);
        this.currentPage = 0;
        this.refreshText();
        this._showDialogue(true);
        this._setDialogueDim(false);
        if (persistentCgStep && persistentCgStep.cg) {
            this._showCg(true, persistentCgStep, { reuseIfSameStep: true });
        } else {
            this._showCg(false);
        }
        const hideUnderCg =
            persistentCgStep && persistentCgStep.hideCharacter !== false;
        this._showCharacter(!hideUnderCg);
    },

    showCgStep(step) {
        // CG：显示 story 图层，并按开关隐藏对话框/立绘
        this._stepId = step && step.id ? step.id : '';
        const pageEl = document.getElementById('page-indicator');
        if (pageEl) {
            pageEl.setAttribute('hidden', '');
            pageEl.textContent = '';
        }
        this._showCg(true, step);
        const hideDlg = !!(step && step.hideDialogue);
        this._showDialogue(!hideDlg);
        this._setDialogueDim(!hideDlg);
        this._showCharacter(!(step && step.hideCharacter));
    },

    closeCgStep() {
        this._showCg(false);
        this._showDialogue(true);
        this._setDialogueDim(false);
        this._showCharacter(true);
    },

    showChoiceStep(step) {
        this._stepId = step && step.id ? step.id : '';
        const pageEl = document.getElementById('page-indicator');
        if (pageEl) {
            pageEl.setAttribute('hidden', '');
            pageEl.textContent = '';
        }
        this._showDialogue(true);
        this._showCg(false);
        this._showCharacter(true);
        this.showOptions((step && step.options) || [], step);
    },

    _resolveSpeakerName(scene, step) {
        if (step && step.type === 'narration') return '';
        const ref = (step && step.speakerRef) || (scene && scene.characterRef) || '';
        if (!ref) return (scene && scene.characterName) || '';
        const roster = SceneManager && SceneManager.storyData ? SceneManager.storyData.characterRoster || [] : [];
        const c = roster.find(x => x.id === ref);
        return c && c.name ? c.name : '';
    },

    _showDialogue(show) {
        const layer = document.getElementById('layer-dialogue');
        if (layer) layer.style.display = show ? 'flex' : 'none';
    },

    _setDialogueDim(dim) {
        const box = document.getElementById('dialogue-box');
        if (!box) return;
        box.classList.toggle('dialogue-dim', !!dim);
    },

    _showCharacter(show) {
        const layer = document.getElementById('layer-char');
        if (layer) layer.style.display = show ? 'flex' : 'none';
    },

    _showCg(show, step = null, opts = {}) {
        const storyLayer = document.getElementById('layer-story');
        if (!storyLayer) return;
        if (!show) {
            const v = storyLayer.querySelector('video');
            if (v) {
                try { v.pause(); } catch {}
            }
            storyLayer.removeAttribute('data-cg-step-id');
            storyLayer.style.display = 'none';
            return;
        }
        storyLayer.style.display = 'flex';
        const reuse =
            opts.reuseIfSameStep &&
            step &&
            step.id &&
            storyLayer.dataset.cgStepId === step.id &&
            storyLayer.querySelector('img, video');
        if (reuse) {
            return;
        }
        // renderer.js 会渲染 scene.storyGraphic；这里补一个 step.cg 的显示入口（后续会统一走 Renderer）
        if (step && step.cg) {
            storyLayer.innerHTML = '';
            const sg = step.cg || {};
            let src = sg.embeddedDataUrl || null;
            if (!src && sg.url) {
                src =
                    typeof AssetManager !== 'undefined' && AssetManager.getPath
                        ? AssetManager.getPath('storyGraphics', sg.url) || sg.url
                        : sg.url;
            }
            if (!src) {
                storyLayer.style.display = 'none';
                return;
            }
            const srcStr = String(src);
            const byExt = /\.(mp4|webm|ogg)(\?|#|$)/i.test(srcStr);
            const mediaType =
                sg.mediaType || (srcStr.startsWith('data:video') || byExt ? 'video' : 'image');
            if (mediaType === 'video') {
                const v = document.createElement('video');
                v.src = src;
                v.autoplay = true;
                v.muted = true;
                v.playsInline = true;
                v.loop = !!(step && step.cgLoop);
                v.controls = false;
                if (!(step && step.cgLoop)) {
                    v.addEventListener('ended', () => {
                        try {
                            if (v.duration && !Number.isNaN(v.duration)) {
                                v.pause();
                                v.currentTime = Math.max(0, v.duration - 0.05);
                            }
                        } catch {}
                    });
                }
                storyLayer.appendChild(v);
            } else {
                const img = new Image();
                img.src = src;
                storyLayer.appendChild(img);
            }
            if (step && step.id) storyLayer.dataset.cgStepId = step.id;
        }
    },

    refreshText() {
        const textEl = document.getElementById('text-content');
        if (textEl) textEl.textContent = this.pages[this.currentPage] || '';
        const pageEl = document.getElementById('page-indicator');
        if (pageEl) {
            if (this.pages.length > 1) {
                pageEl.removeAttribute('hidden');
                pageEl.textContent = `${this.currentPage + 1}/${this.pages.length}`;
            } else {
                pageEl.setAttribute('hidden', '');
                pageEl.textContent = '';
            }
        }
    },

    isAtEndOfStep() {
        return this.currentPage >= this.pages.length - 1;
    },

    jumpToEndOfStep() {
        this.currentPage = Math.max(0, this.pages.length - 1);
        this.refreshText();
    },

    nextPage() {
        if (this.currentPage < this.pages.length - 1) {
            this.currentPage++;
            this.refreshText();
        }
    },

    prevPage() {
        if (this.currentPage > 0) {
            this.currentPage--;
            this.refreshText();
        }
    },

    // 显示选项（choice step）
    showOptions(options, step = null) {
        const layer = document.getElementById('layer-options');
        const container = document.getElementById('options-container');
        container.innerHTML = '';

        const list = Array.isArray(options) ? options : [];
        list.forEach(opt => {
            if (opt && typeof SceneManager !== 'undefined' && SceneManager.evalCondition) {
                if (!SceneManager.evalCondition(opt.condition)) return;
            }
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerText = opt.text;
            btn.onclick = () => {
                this.hideOptions();
                if (typeof StoryEffects !== 'undefined' && StoryEffects.stopLoopingStepSound) {
                    StoryEffects.stopLoopingStepSound();
                }
                if (opt && Array.isArray(opt.effects) && typeof GameState !== 'undefined' && GameState.applyEffects) {
                    GameState.applyEffects(opt.effects);
                }
                if (SceneManager && SceneManager.applyNext) {
                    SceneManager.applyNext(opt.next);
                }
            };
            container.appendChild(btn);
        });
        layer.style.display = 'flex';
    },

    hideOptions() {
        document.getElementById('layer-options').style.display = 'none';
    }
};
