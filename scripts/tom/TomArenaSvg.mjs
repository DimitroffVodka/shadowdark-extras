const DEF = `<defs><filter id="arenaGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#f59e0b;stop-opacity:1"/><stop offset="50%" style="stop-color:#fbbf24;stop-opacity:1"/><stop offset="100%" style="stop-color:#d97706;stop-opacity:1"/></linearGradient></defs>`;

function svgWrap(inner) {
	return `<svg viewBox="0 -50 1000 700" preserveAspectRatio="xMidYMid meet">${DEF}${inner}</svg>`;
}

function topdownInner() {
	return `
      <circle cx="500" cy="300" r="280" class="tom-arena-ring tom-arena-ring-90" fill="none" stroke="url(#ringGradient)" stroke-width="2" filter="url(#arenaGlow)" opacity="0.7"/>
      <text x="500" y="10" class="tom-arena-label" text-anchor="middle">FAR</text>
      <circle cx="500" cy="300" r="140" class="tom-arena-ring tom-arena-ring-30" fill="none" stroke="url(#ringGradient)" stroke-width="2" filter="url(#arenaGlow)" opacity="0.9"/>
      <text x="500" y="150" class="tom-arena-label" text-anchor="middle">NEAR</text>
      <circle cx="500" cy="300" r="140" class="tom-arena-center" fill="rgba(251,191,36,0.1)" stroke="url(#ringGradient)" stroke-width="3" filter="url(#arenaGlow)"/>
      <text x="500" y="305" class="tom-arena-label tom-arena-label-center" text-anchor="middle">CLOSE</text>`;
}

function expandedInner() {
	return `
      <circle cx="500" cy="300" r="320" fill="rgba(59,130,246,0.1)" stroke="#3b82f6" stroke-width="2" opacity="0.8"/>
      <circle cx="500" cy="300" r="255" fill="rgba(34,197,94,0.1)" stroke="#22c55e" stroke-width="2" opacity="0.8"/>
      <circle cx="500" cy="300" r="190" fill="rgba(234,179,8,0.1)" stroke="#eab308" stroke-width="2" opacity="0.8"/>
      <circle cx="500" cy="300" r="125" fill="rgba(249,115,22,0.1)" stroke="#f97316" stroke-width="2" opacity="0.8"/>
      <circle cx="500" cy="300" r="55" fill="rgba(239,68,68,0.3)" stroke="#ef4444" stroke-width="4"/>
      <text x="500" y="305" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:14px;text-shadow:0 0 4px #000" text-anchor="middle">ENGAGED</text>
      <text x="500" y="212" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:12px;text-shadow:0 0 4px #000" text-anchor="middle">SHORT</text>
      <text x="500" y="146" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:12px;text-shadow:0 0 4px #000" text-anchor="middle">MEDIUM</text>
      <text x="500" y="80" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:12px;text-shadow:0 0 4px #000" text-anchor="middle">LONG</text>
      <text x="500" y="14" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:12px;text-shadow:0 0 4px #000" text-anchor="middle">EXTREME</text>
      <g stroke="#000" stroke-width="2" opacity="0.5">
        <line x1="500" y1="50" x2="500" y2="10" transform="rotate(0 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(30 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(60 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(90 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(120 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(150 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(180 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(210 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(240 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(270 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(300 500 300)"/><line x1="500" y1="50" x2="500" y2="10" transform="rotate(330 500 300)"/>
      </g>
      <g stroke="#000" stroke-width="1" opacity="0.3">
        <line x1="500" y1="300" x2="500" y2="10" transform="rotate(0 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(30 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(60 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(90 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(120 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(150 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(180 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(210 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(240 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(270 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(300 500 300)"/><line x1="500" y1="300" x2="500" y2="10" transform="rotate(330 500 300)"/>
      </g>`;
}

function ladderInner() {
	return `
      <rect x="50" y="250" width="900" height="100" rx="10" ry="10" fill="rgba(0,0,0,0.3)" stroke="#444" stroke-width="2"/>
      <rect x="50" y="250" width="180" height="100" rx="10" ry="0" fill="rgba(239,68,68,0.4)"/>
      <text x="140" y="310" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:16px;text-shadow:0 0 4px #000" text-anchor="middle">ENGAGED</text>
      <rect x="230" y="250" width="180" height="100" fill="rgba(249,115,22,0.3)"/>
      <text x="320" y="310" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:16px;text-shadow:0 0 4px #000" text-anchor="middle">CLOSE</text>
      <rect x="410" y="250" width="180" height="100" fill="rgba(234,179,8,0.3)"/>
      <text x="500" y="310" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:16px;text-shadow:0 0 4px #000" text-anchor="middle">NEAR</text>
      <rect x="590" y="250" width="180" height="100" fill="rgba(34,197,94,0.3)"/>
      <text x="680" y="310" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:16px;text-shadow:0 0 4px #000" text-anchor="middle">FAR</text>
      <rect x="770" y="250" width="180" height="100" rx="0" ry="10" fill="rgba(59,130,246,0.3)"/>
      <text x="860" y="310" fill="#fff" style="font-weight:bold;font-family:sans-serif;font-size:14px;text-shadow:0 0 4px #000" text-anchor="middle">OUT OF RANGE</text>
      <line x1="230" y1="250" x2="230" y2="350" stroke="#888" stroke-width="2"/><line x1="410" y1="250" x2="410" y2="350" stroke="#888" stroke-width="2"/><line x1="590" y1="250" x2="590" y2="350" stroke="#888" stroke-width="2"/><line x1="770" y1="250" x2="770" y2="350" stroke="#888" stroke-width="2"/>
      <polygon points="30,300 50,280 50,320" fill="url(#ringGradient)" filter="url(#arenaGlow)"/><polygon points="970,300 950,280 950,320" fill="url(#ringGradient)" filter="url(#arenaGlow)"/>`;
}

function isometricInner() {
	return `
      <ellipse cx="500" cy="300" rx="420" ry="210" class="tom-arena-ring tom-arena-ring-90" fill="none" stroke="url(#ringGradient)" stroke-width="2" filter="url(#arenaGlow)" opacity="0.7"/>
      <text x="500" y="60" class="tom-arena-label" text-anchor="middle">FAR</text>
      <ellipse cx="500" cy="300" rx="180" ry="90" class="tom-arena-ring tom-arena-ring-30" fill="none" stroke="url(#ringGradient)" stroke-width="2" filter="url(#arenaGlow)" opacity="0.9"/>
      <text x="500" y="180" class="tom-arena-label" text-anchor="middle">NEAR</text>
      <ellipse cx="500" cy="300" rx="180" ry="90" class="tom-arena-ring tom-arena-center" fill="rgba(251,191,36,0.1)" stroke="url(#ringGradient)" stroke-width="3" filter="url(#arenaGlow)"/>
      <text x="500" y="305" class="tom-arena-label tom-arena-label-center" text-anchor="middle">CLOSE</text>`;
}

export function arenaInnerForType(arenaType) {
	switch (arenaType) {
		case "topdown": return topdownInner();
		case "expanded": return expandedInner();
		case "ladder": return ladderInner();
		case "isometric": return isometricInner();
		case "none": return "";
		default: return isometricInner();
	}
}

export function arenaSvgForType(arenaType) {
	const inner = arenaInnerForType(arenaType);
	if (!inner) return "";
	return svgWrap(inner);
}

export function isArenaNone(arenaType) {
	return arenaType === "none";
}
