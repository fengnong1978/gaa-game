/**
 * renderer.js - 视觉渲染核心 (别名解析 + 等比布局)
 */
const Renderer = {
    storyData: null,
    imageCache: {},

    resolveCharacterSpriteUrl(scene) {
        return CharacterBinding.resolveSpriteUrl(scene, this.storyData);
    },

    async init(data) {
        this.storyData = data;
        if (typeof AssetManager !== 'undefined' && AssetManager.init) {
            AssetManager.init();
            AssetManager.applyProjectEmbedded(data.embeddedAssetLibrary || null);
        }
        if (typeof SceneManager !== 'undefined' && SceneManager.init) {
            SceneManager.init(data);
        }
        this.preloadAllResources();
        this.setupEvents();
        const firstId = (data.scenes && data.scenes[0] && data.scenes[0].id) || 'start';
        SceneManager.jumpTo(firstId);
    },

    async preloadAllResources() {
        if (!this.storyData || !this.storyData.scenes) return;
        const imagesToLoad = [];
        this.storyData.scenes.forEach(scene => {
            if (scene.background && scene.background.url) {
                const alias = scene.background.url;
                const path =
                    typeof AssetManager !== 'undefined' && AssetManager.getPath
                        ? AssetManager.getPath('backgrounds', alias) || alias
                        : alias;
                if (path) imagesToLoad.push(path);
            }
            if (scene.storyGraphic) {
                if (scene.storyGraphic.embeddedDataUrl) {
                    imagesToLoad.push(scene.storyGraphic.embeddedDataUrl);
                } else if (scene.storyGraphic.url) {
                    const a = scene.storyGraphic.url;
                    const path =
                        typeof AssetManager !== 'undefined' && AssetManager.getPath
                            ? AssetManager.getPath('storyGraphics', a) || a
                            : a;
                    if (path) imagesToLoad.push(path);
                }
            }
        });
        const aliases =
            typeof AssetManager !== 'undefined' && AssetManager.collectCharacterSpriteAliases
                ? AssetManager.collectCharacterSpriteAliases(this.storyData)
                : new Set();
        aliases.forEach(alias => {
            const path =
                typeof AssetManager !== 'undefined' && AssetManager.getPath
                    ? AssetManager.getPath('characters', alias) || alias
                    : alias;
            if (path) imagesToLoad.push(path);
        });

        const uniqueImages = [...new Set(imagesToLoad)];
        uniqueImages.forEach(url => {
            const img = new Image();
            img.src = url;
            this.imageCache[url] = img;
        });
    },

    setupEvents() {
        document.getElementById('game-canvas').addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            if (typeof SceneManager !== 'undefined' && SceneManager.onAdvance) {
                SceneManager.onAdvance();
            }
        });
    },

    renderScene(scene) {
        if (!scene) return;
        if (typeof StoryEffects !== 'undefined' && StoryEffects.clear) {
            StoryEffects.clear();
        }

        const bgRaw = scene.background || {};
        const bgNorm = LayoutHelpers.normalizeBackground(bgRaw);
        const bgLayer = document.getElementById('layer-bg');
        bgLayer.innerHTML = '';
        const bgPath =
            typeof AssetManager !== 'undefined' && AssetManager.getPath
                ? AssetManager.getPath('backgrounds', bgRaw.url) || bgRaw.url
                : bgRaw.url;
        const bgImg = (bgPath && this.imageCache[bgPath]) || new Image();
        if (bgPath && !this.imageCache[bgPath]) bgImg.src = bgPath;

        const applyBg = () => LayoutHelpers.applyBackgroundContain(bgImg, bgNorm);
        if (bgImg.complete && bgImg.naturalWidth) applyBg();
        else bgImg.onload = applyBg;
        bgLayer.appendChild(bgImg);

        const charLayer = document.getElementById('layer-char');
        charLayer.innerHTML = '';
        // 立绘由 enterCurrentStep 在更新对话框布局后再绘制（否则小图高度测量错误）

        const storyLayer = document.getElementById('layer-story');
        if (storyLayer) {
            storyLayer.innerHTML = '';
            const sg = scene.storyGraphic || {};
            let storySrc = null;
            if (sg.embeddedDataUrl) storySrc = sg.embeddedDataUrl;
            else if (sg.url) {
                storySrc =
                    typeof AssetManager !== 'undefined' && AssetManager.getPath
                        ? AssetManager.getPath('storyGraphics', sg.url) || sg.url
                        : sg.url;
            }
            if (storySrc) {
                const img = this.imageCache[storySrc] || new Image();
                if (!this.imageCache[storySrc]) img.src = storySrc;
                const wrap = document.createElement('div');
                wrap.style.cssText =
                    'position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
                wrap.appendChild(img);
                storyLayer.appendChild(wrap);

                const runFx = () => {
                    if (typeof StoryEffects !== 'undefined' && StoryEffects.runForScene) {
                        StoryEffects.runForScene(scene, { storyImg: img, storyWrap: wrap });
                    }
                };
                if (img.complete && img.naturalWidth) runFx();
                else {
                    img.onload = runFx;
                    img.onerror = runFx;
                }
            } else if (typeof StoryEffects !== 'undefined' && StoryEffects.runForScene) {
                StoryEffects.runForScene(scene, { storyImg: null, storyWrap: null });
            }
        }

        // 对话/CG/选项由 SceneManager.enterCurrentStep() 驱动 UIManager 展示
    }
};

Renderer.renderCharacterForStep = function (scene, step) {
    const charLayer = document.getElementById('layer-char');
    if (!charLayer) return;
    charLayer.innerHTML = '';
    if (!scene) return;

    // narration/choice/random/cg 步骤默认不显示立绘（CG 是否显示立绘由 UIManager 控制 show/hide layer-char）
    const t = step && step.type ? step.type : 'dialogue';
    if (t !== 'dialogue') return;

    const charPath = CharacterBinding.resolveSpriteUrlForStep(scene, step, this.storyData);
    if (!charPath) return;

    const dlgBox = document.getElementById('dialogue-box');
    /**
     * 立绘可用高度（小图）：
     * 运行端对话层固定 bottom:24px，因此用逻辑坐标直接计算更稳定，
     * 避免 getBoundingClientRect 在缩放/像素比下带来微偏差。
     */
    let slotH = 520;
    if (dlgBox) {
        const DIALOG_BOTTOM = 24;
        // 运行端对白框为固定三行高度，正常在约 136px；给出固定下限避免字体渲染差异导致槽高飘动
        const boxH = Math.max(136, dlgBox.offsetHeight || 136);
        const raw = LayoutHelpers.VIEW_H - DIALOG_BOTTOM - boxH - 4;
        slotH = Math.max(48, Math.min(LayoutHelpers.VIEW_H, raw));
    }

    const mode = (step && step.charMode) || 'big'; // 'big' | 'small'
    const mirror = !!(step && step.mirror);

    const laySource =
        step && step.charLayout && typeof step.charLayout === 'object'
            ? { layout: step.charLayout }
            : scene.character;
    const lay = LayoutHelpers.normalizeCharacterLayout(laySource);
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.left = '50%';
    wrap.style.pointerEvents = 'none';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'flex-end';
    wrap.style.justifyContent = 'center';
    wrap.style.transformOrigin = '50% 100%';

    if (mode === 'small') {
        // 小图：上沿对齐画布顶，下沿对齐对话框组件上沿（槽内等比放大，底部对齐）
        wrap.style.top = '0';
        wrap.style.bottom = 'auto';
        wrap.style.height = `${slotH}px`;
    } else {
        // 大图：占满全屏高（等比，仅控制高度）
        wrap.style.top = '0';
        wrap.style.bottom = '0';
        wrap.style.height = '';
    }

    wrap.style.transform = `translateX(calc(-50% + ${lay.panX}px)) translateY(${lay.panY}px) scale(${lay.zoom})`;

    const img = this.imageCache[charPath] || new Image();
    if (!this.imageCache[charPath]) img.src = charPath;
    img.style.height = '100%';
    img.style.width = 'auto';
    img.style.objectFit = 'contain';
    img.style.transform = mirror ? 'scaleX(-1)' : '';

    wrap.appendChild(img);
    charLayer.appendChild(wrap);
};

SceneManager.jumpTo = function (id) {
    this.jumpToScene(id, '');
};
