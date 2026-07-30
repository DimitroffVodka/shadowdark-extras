/**
 * SDX Coords — Map coordinate overlay for Shadowdark Extras
 * Clean-room reimplementation inspired by map-coords functionality
 */

const MODULE_ID = "shadowdark-extras";

// Display states for coordinate overlay
const DISPLAY_STATES = {
    HIDDEN: 1,
    MARGIN: 2,
    CELL: 3,
    ZINE: 4,
};

/**
 * Get the correct PreciseText class for the current Foundry version
 */
function getPreciseText() {
    return Number(game.version) >= 13
        ? foundry.canvas.containers.PreciseText
        : PreciseText;
}

/**
 * Get the current coordinate settings, merged with defaults
 */
function getSettings() {
    const defaults = {
        fontFamily: "Signika-Bold",
        fillColor: "#ffffff",
        strokeColor: "#000000",
        strokeThickness: 3,
        xValue: "let",
        yValue: "num",
        offset: 0,
        cellFontScale: 14,
        cellAlpha: 0.9,
        leadingZeroes: false,
        keybindModifier: "Alt",
        clickTimeout: 1500,
    };
    try {
        const saved = game.settings.get(MODULE_ID, "sdxCoordsSettings");
        return foundry.utils.mergeObject(defaults, saved || {});
    } catch {
        return defaults;
    }
}

/**
 * Core coordinate overlay class
 */
class SDXCoord {
    #state;
    #overrideState;
    #marginContainer;
    #cellContainer;
    #zineContainer;

    constructor() {
        const settings = getSettings();
        const rect = canvas.dimensions.sceneRect;
        const size = canvas.dimensions.size;

        // Build the text style
        this._style = CONFIG.canvasTextStyle.clone();
        this._style.fill = settings.fillColor;
        this._style.fontFamily = settings.fontFamily || "Signika-Bold";
        this._style.fontSize = size / 2;
        this._style.stroke = settings.strokeColor;
        this._style.strokeThickness = settings.strokeThickness;

        this._rect = rect;
        this._size = size;
        this._cellWidth = canvas.grid.sizeX;
        this._cellHeight = canvas.grid.sizeY;

        // Grid offset for the top-left corner of the scene
        const topLeft = canvas.grid.getOffset({ x: rect.left, y: rect.top });
        this._row0 = topLeft.i;
        this._col0 = topLeft.j;

        // Settings
        this._xValue = settings.xValue;
        this._yValue = settings.yValue;
        this._marginOffset = settings.offset;
        this._cellFontScale = settings.cellFontScale;
        this._cellAlpha = settings.cellAlpha;
        this._leadingZeroes = settings.leadingZeroes;
        this._keybindModifier = settings.keybindModifier;
        this._clickTimeout = settings.clickTimeout;

        // Padding for leading zeroes
        if (this._leadingZeroes) {
            this._zeroPad = String(
                Math.max(canvas.dimensions.columns, canvas.dimensions.rows)
            ).length;
        } else {
            this._zeroPad = 0;
        }

        // Create PIXI containers
        this.#marginContainer = canvas.controls.addChild(new PIXI.Container());
        this.#cellContainer = canvas.controls.addChild(new PIXI.Container());
        this.#zineContainer = canvas.controls.addChild(new PIXI.Container());
        this.#marginContainer.visible = false;
        this.#cellContainer.visible = false;
        this.#zineContainer.visible = false;

        // Render labels
        this._renderMarginLabels();
        this._renderCellLabels();
        this._renderZineLabels();

        // Click listener for one-click coordinate display
        this._addClickListener();

        // Restore display state from scene flags
        this.#state = this._readSceneState();
        this._applyState(this.#state);
    }

    // ---- Label Generation ----

    _generateLabel(type, index) {
        if (type === "num") {
            return `${(index + 1).toString().padStart(this._zeroPad, "0")}`;
        }
        // Letters: A, B, ..., Z, AA, AB, ...
        if (index < 26) return String.fromCharCode(65 + index);
        return SDXCoord._numberToLetters(index + 1);
    }

    _formatColumnHeader(index, style = "standard") {
        if (style === "zine") return String(index * 100).padStart(3, "0");
        return this._generateLabel(this._xValue, this._standardColumn(index));
    }

    _formatRowHeader(index, style = "standard") {
        if (style === "zine") return String(index + 1).padStart(2, "0");
        return this._generateLabel(this._yValue, index);
    }

    _formatCellLabel(row, col, style = "standard") {
        if (style === "zine") return `${this._zineColumn(col)}${String(this._zineRow(row, col)).padStart(2, "0")}`;
        const rowLabel = this._generateLabel(this._yValue, row);
        const colLabel = this._generateLabel(this._xValue, this._standardColumn(col));
        return SDXCoord._formatPair(rowLabel, colLabel);
    }

    static _numberToLetters(num) {
        let s = "";
        let t;
        while (num > 0) {
            t = (num - 1) % 26;
            s = String.fromCharCode(65 + t) + s;
            num = ((num - t) / 26) | 0;
        }
        return s || "";
    }

    static _formatPair(row, col) {
        return `${col}${row}`;
    }

    // ---- Hex Adjustments ----

    /**
     * @param {number} row - relative row index
     * @param {number|null} absCol - absolute column j-index (needed for hex column grids)
     */
    _adjustRow(row, absCol = null) {
        if (!canvas.grid.isHexagonal) return row;
        if (canvas.grid.even && !canvas.grid.columns) return row - 1;
        // Hex column grids: non-shifted columns have a half hex at top — skip it
        if (canvas.grid.columns && absCol !== null) {
            // Odd variant: even j columns are non-shifted (half hex at top)
            // Even variant: odd j columns are non-shifted (half hex at top)
            const hasHalfHex = canvas.grid.even ? (absCol % 2 !== 0) : (absCol % 2 === 0);
            if (hasHalfHex) return row - 1;
        }
        return row;
    }

    _adjustCol(col) {
        return canvas.grid.isHexagonal && canvas.grid.even && canvas.grid.columns
            ? col - 1
            : col;
    }

    /**
     * Map a (already _adjustCol-ed) grid column index to the zine axis column.
     *
     * On hex-column maps the printed zine "000" axis header sits over the first
     * FULL playable hex column; the cropped/partial edge column to its left is
     * not counted. The top axis labels are shifted right by one column for this
     * reason (see _renderMarginLabels), so the per-cell column number must drop
     * by one to stay aligned with the header above it — e.g. a cell our raw grid
     * would call 202 prints as 102 in the zine. Square / hex-row maps are not
     * shifted, so they are returned unchanged.
     *
     * @param {number} col - column index after _adjustCol
     * @returns {number} zine axis column (may be -1 for the cropped edge column)
     */
    _zineColumn(col) {
        if (canvas.grid.isHexagonal && canvas.grid.columns) return col - 1;
        return col;
    }

    /**
     * Per-cell zine row number (1-based) for the given cell.
     *
     * Hex-column zine maps stagger in two phases: after the _zineColumn shift,
     * the even zine columns (200/400/600...) are the half-hex-LOWER phase, while
     * the odd columns (100/300/500...) are the raised phase. A raw `row + 1`
     * already prints the odd columns correctly, but on the staggered even
     * columns the per-cell row index runs one step ahead, so it prints one too
     * high (a cell that should read 203 prints 204). Journal pins are ground
     * truth — e.g. x=690 y=776 is "203. Marker Stone" — so drop the even zine
     * columns by one to realign both phases. Square / hex-row maps don't stagger
     * this way and are returned unchanged.
     *
     * @param {number} row - row index after _adjustRow
     * @param {number} col - column index after _adjustCol
     * @returns {number} 1-based row number to print in the zine hex ID
     */
    _zineRow(row, col) {
        const base = row + 1;
        if (canvas.grid.isHexagonal && canvas.grid.columns && this._zineColumn(col) % 2 === 0) {
            return base - 1;
        }
        return base;
    }

    /**
     * Standard lettered coordinate maps should also ignore the cropped/blank
     * edge column on hex-column scenes: A starts on the first full playable
     * column, matching the zine axis shift. Numeric X labels keep their
     * existing behavior for backwards compatibility.
     *
     * @param {number} col - column index after _adjustCol
     * @returns {number} displayed standard column index
     */
    _standardColumn(col) {
        if (this._xValue === "let" && canvas.grid.isHexagonal && canvas.grid.columns) return col - 1;
        return col;
    }

    // ---- Rendering ----

    _renderMarginLabels(container = this.#marginContainer, style = "standard") {
        const PT = getPreciseText();
        let pos, label, text;

        // Column headers (top)
        let c = 0;
        do {
            const adjCol = this._adjustCol(c);
            label = this._formatColumnHeader(adjCol, style);
            text = new PT(label, this._style);
            text.resolution = 4;
            text.anchor.set(0.5);
            const tl = canvas.grid.getTopLeftPoint({ i: this._row0, j: c + this._col0 });
            pos = [tl.x + this._cellWidth / 2, this._rect.top - this._marginOffset - this._size / 4];

            if (style === "zine" && canvas.grid.isHexagonal && canvas.grid.columns) {
                // The printed zine coordinate axes start over the first full
                // playable hex column, not the cropped/partial edge column.
                // Move the top labels one column step to the right so 000 is
                // over that first real column, then 100/200/etc. follow.
                pos[0] += this._cellWidth * 0.75;
            }

            // Shadowdark zine hex maps stagger the top coordinate headers:
            // 000/200/400 sit lower in the valleys, while 100/300/500 sit
            // higher above the top edge of the raised hex columns.
            if (style === "zine" && canvas.grid.isHexagonal && canvas.grid.columns && adjCol % 2 === 0) {
                pos[1] += this._size * 0.28;
            }
            text.position.set(pos[0], pos[1]);

            const displayCol = style === "zine" ? adjCol : this._standardColumn(adjCol);
            if (pos[0] >= this._rect.left && pos[0] <= this._rect.right && displayCol >= 0) {
                container.addChild(text);
            }
            c += 1;
        } while (pos[0] + text.width < this._rect.right);

        // Row headers (left)
        let r = 0;
        let zineRow = 0;
        do {
            const adjRow = this._adjustRow(r);
            label = style === "zine" ? String(zineRow + 1).padStart(2, "0") : this._formatRowHeader(adjRow, style);
            text = new PT(label, this._style);
            text.resolution = 4;
            text.anchor.set(0.5, 0.5);
            const tl = canvas.grid.getTopLeftPoint({ i: r + this._row0, j: this._col0 });
            pos = [this._rect.left - this._marginOffset - this._size / 4, tl.y + this._cellHeight / 2];
            text.position.set(pos[0], pos[1]);

            if (pos[1] >= this._rect.top && pos[1] <= this._rect.bottom && adjRow >= 0) {
                container.addChild(text);
                zineRow += 1;
            }
            r += 1;
        } while (pos[1] + text.height < this._rect.bottom);
    }

    _renderCellLabels(container = this.#cellContainer, style = "standard") {
        const PT = getPreciseText();
        const cellStyle = this._style.clone();
        const fontScale = Math.max(10, this._cellFontScale) / 100;
        cellStyle.fontSize = this._size * fontScale;

        let c = 0;
        let pos = [this._rect.x, this._rect.y];
        do {
            const absCol = c + this._col0;
            const adjCol = this._adjustCol(c);
            let r = 0;
            do {
                const tl = canvas.grid.getTopLeftPoint({ i: r + this._row0, j: c + this._col0 });
                pos = [tl.x, tl.y];

                const adjRow = this._adjustRow(r, absCol);
                if (adjRow < 0) { r += 1; continue; }

                // In zine mode the cropped/partial edge column is not numbered
                // (its zine column would be -1); skip it to match the shifted axis.
                if (style === "zine" && this._zineColumn(adjCol) < 0) { r += 1; continue; }
                if (style !== "zine" && this._standardColumn(adjCol) < 0) { r += 1; continue; }

                const text = new PT(this._formatCellLabel(adjRow, adjCol, style), cellStyle);
                text.resolution = 4;
                text.alpha = this._cellAlpha;

                if (canvas.grid.isHexagonal) {
                    pos[0] += this._cellWidth / 2 - text.width / 2;
                    if (!canvas.grid.columns) pos[1] += text.height / 3;
                }

                if (this._rect.contains(pos[0], pos[1])) {
                    text.position.set(pos[0], pos[1]);
                    container.addChild(text);
                }

                r += 1;
            } while (pos[1] < this._rect.bottom);
            c += 1;
        } while (pos[0] < this._rect.right);
    }

    _renderZineLabels() {
        this._renderMarginLabels(this.#zineContainer, "zine");
        this._renderCellLabels(this.#zineContainer, "zine");
    }

    // ---- Click Coordinate ----

    _addClickListener() {
        canvas.stage.addListener(
            "click",
            (event) => {
                if (game.keyboard.isModifierActive(this._keybindModifier)) {
                    this._showClickCoordinate();
                }
            }
        );
    }

    _showClickCoordinate() {
        const PT = getPreciseText();
        const pos = canvas.mousePosition;
        const offset = canvas.grid.getOffset({ x: pos.x, y: pos.y });
        const row = this._adjustRow(offset.i - this._row0, offset.j);
        const col = this._adjustCol(offset.j - this._col0);
        const style = this._readSceneState() === DISPLAY_STATES.ZINE ? "zine" : "standard";
        const text = new PT(this._formatCellLabel(row, col, style), this._style);
        text.resolution = 4;
        text.anchor.set(0.2);
        text.position.set(pos.x, pos.y);

        const label = canvas.controls.addChild(text);
        setTimeout(() => label.destroy(), this._clickTimeout);
    }

    // ---- State Management ----

    _readSceneState() {
        if (this.#overrideState) return this.#overrideState;
        return canvas?.scene?.getFlag(MODULE_ID, "sdxcoords-state") || DISPLAY_STATES.HIDDEN;
    }

    _applyState(state) {
        this.#marginContainer.visible = false;
        this.#cellContainer.visible = false;
        this.#zineContainer.visible = false;

        switch (state) {
            case DISPLAY_STATES.MARGIN:
                this.#marginContainer.visible = true;
                break;
            case DISPLAY_STATES.CELL:
                this.#cellContainer.visible = true;
                break;
            case DISPLAY_STATES.ZINE:
                this.#zineContainer.visible = true;
                break;
            default:
                break;
        }
    }

    toggle() {
        let next;
        const current = this._readSceneState();
        switch (current) {
            case DISPLAY_STATES.HIDDEN:
                next = DISPLAY_STATES.MARGIN;
                break;
            case DISPLAY_STATES.MARGIN:
                next = DISPLAY_STATES.CELL;
                break;
            case DISPLAY_STATES.CELL:
                next = DISPLAY_STATES.ZINE;
                break;
            default:
                next = DISPLAY_STATES.HIDDEN;
                break;
        }
        this._applyState(next);
        if (game.user.isGM) {
            canvas.scene.setFlag(MODULE_ID, "sdxcoords-state", next);
        } else {
            this.#overrideState = next;
        }
        this.#state = next;
    }

    finalize() {
        canvas.controls.removeChild(this.#marginContainer);
        canvas.controls.removeChild(this.#cellContainer);
        canvas.controls.removeChild(this.#zineContainer);
        this.#marginContainer.visible = false;
        this.#cellContainer.visible = false;
        this.#zineContainer.visible = false;
    }

    static get isSupported() {
        return canvas.grid?.isSquare || canvas.grid?.isHexagonal;
    }
}

// ---- Hook Setup ----

/**
 * Initialize SDX Coords hooks. Call from shadowdark-extras.mjs.
 */
export function initSDXCoords() {
    // Canvas ready — create/destroy coordinate overlay
    Hooks.on("canvasReady", async () => {
        if (window.SDXCoordinates) {
            window.SDXCoordinates.finalize();
            window.SDXCoordinates = null;
        }
        if (SDXCoord.isSupported) {
            // Preload the chosen font so PIXI canvas 2D text can use it
            const settings = getSettings();
            const fontFamily = settings.fontFamily || "Signika-Bold";
            try {
                await document.fonts.load(`16px "${fontFamily}"`);
            } catch { /* font may not exist, PIXI will use fallback */ }
            window.SDXCoordinates = new SDXCoord();
        }
    });
}

/**
 * Register SDX Coords settings. Call from the init hook in shadowdark-extras.mjs.
 */
export function registerSDXCoordsSettings() {
    // Hidden data setting
    game.settings.register(MODULE_ID, "sdxCoordsSettings", {
        name: "Map Coordinates Settings",
        scope: "world",
        config: false,
        type: Object,
        default: {
            fontFamily: "Signika-Bold",
            fillColor: "#ffffff",
            strokeColor: "#000000",
            strokeThickness: 3,
            xValue: "let",
            yValue: "num",
            offset: 0,
            cellFontScale: 14,
            cellAlpha: 0.9,
            leadingZeroes: false,
            keybindModifier: "Alt",
            clickTimeout: 1500,
        },
    });

    // Keybinding
    game.keybindings.register(MODULE_ID, "sdx-toggle-coords", {
        name: "Toggle Map Coordinates",
        editable: [{ key: "KeyC", modifiers: ["ALT"] }],
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
        restricted: false,
        onDown: () => {
            if (window.SDXCoordinates) window.SDXCoordinates.toggle();
            else ui.notifications.warn("Coordinate display not supported on gridless maps");
            return true;
        },
    });
}

/**
 * Register the settings menu button. Must be called after dynamic import is ready.
 */
export function registerSDXCoordsMenu(AppClass) {
    game.settings.registerMenu(MODULE_ID, "sdxCoordsMenu", {
        name: "Map Coordinates Settings",
        label: "Configure Coordinates",
        hint: "Configure coordinate overlay appearance and behavior",
        icon: "far fa-globe",
        type: AppClass,
        restricted: true,
    });
}

/**
 * Format a grid offset {i, j} into the same coordinate label shown by the overlay.
 * Returns a string like "0101" matching the SDXCoords display.
 */
export function formatHexCoord(offset) {
    if (!canvas?.grid) return `${offset.i}.${offset.j}`;
    const settings = getSettings();
    const rect = canvas.dimensions.sceneRect;
    const topLeft = canvas.grid.getOffset({ x: rect.left, y: rect.top });
    const relRow = offset.i - topLeft.i;
    const relCol = offset.j - topLeft.j;

    // Adjust for hex grid quirks
    let adjRow = relRow;
    let adjCol = relCol;
    if (canvas.grid.isHexagonal) {
        if (canvas.grid.even && !canvas.grid.columns) adjRow = relRow - 1;
        if (canvas.grid.columns) {
            const hasHalfHex = canvas.grid.even ? (offset.j % 2 !== 0) : (offset.j % 2 === 0);
            if (hasHalfHex) adjRow = relRow - 1;
        }
        if (canvas.grid.even && canvas.grid.columns) adjCol = relCol - 1;
    }

    const zeroPad = settings.leadingZeroes
        ? String(Math.max(canvas.dimensions.columns, canvas.dimensions.rows)).length
        : 0;

    function genLabel(type, index) {
        if (type === "num") return `${(index + 1).toString().padStart(zeroPad, "0")}`;
        if (index < 26) return String.fromCharCode(65 + index);
        return SDXCoord._numberToLetters(index + 1);
    }

    if (settings.xValue === "let" && canvas.grid.isHexagonal && canvas.grid.columns) adjCol -= 1;

    const colLabel = genLabel(settings.xValue, adjCol);
    const rowLabel = genLabel(settings.yValue, adjRow);
    return `${colLabel}${rowLabel}`;
}
