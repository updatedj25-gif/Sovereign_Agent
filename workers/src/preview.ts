export function sanitizeForLivePreview(rawCode: string): string {
  let code = rawCode;
  code = code.replace(/^```(?:tsx|jsx|typescript|ts|javascript|js)?\n/i, "");
  code = code.replace(/\n```$/i, "");
  code = code.replace(/import\s+(?:type\s+)?(?:[\w*\s{},]*)\s+from\s+['"][^'"]+['"];?/g, "// [import]");
  code = code.replace(/import\s+['"][^'"]+['"];?/g, "// [import]");
  code = code.replace(/export\s+default\s+function\s+App/g, "function App");
  code = code.replace(/export\s+default\s+function\s+(\w+)/g, "function $1");
  code = code.replace(/export\s+default\s+(\w+);?/g, "const __defaultExport = $1;");

  const declaredComponents: string[] = [];
  const compMatches = code.matchAll(/(?:const|function|let|var)\s+([A-Z]\w+)/g);
  for (const m of compMatches) {
    if (!["React", "ReactDOM", "View", "Text", "TouchableOpacity", "TextInput", "ScrollView", "Image", "StyleSheet"].includes(m[1])) {
      declaredComponents.push(m[1]);
    }
  }

  if (!code.includes("function App") && !code.includes("const App") && !code.includes("let App") && !code.includes("var App")) {
    if (declaredComponents.length > 0) {
      code += `\nconst App = typeof __defaultExport !== 'undefined' ? __defaultExport : ${declaredComponents[0]};\n`;
    }
  }
  return code;
}

export function buildPreviewHtml(appCode: string, rawCss: string, title: string): string {
  const sanitizedCode = sanitizeForLivePreview(appCode);
  const cleanCss = (rawCss || "").replace(/@import\s+["']tailwindcss["'];?/g, "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #root { width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
    ${cleanCss}
  </style>
</head>
<body class="bg-slate-950 text-white min-h-screen">
  <div id="root"></div>
  <div id="preview-error" class="hidden m-4 p-4 rounded-xl bg-red-950/90 border border-red-500/50 text-red-200 font-mono text-xs whitespace-pre-wrap"></div>
  
  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext } = React;

    // React Native Web Polyfills
    const View = (props) => <div {...props} className={props.className || ''} style={{ display: 'flex', flexDirection: 'column', boxSizing: 'border-box', ...(props.style || {}) }}>{props.children}</div>;
    const Text = (props) => <span {...props} className={props.className || ''} style={{ boxSizing: 'border-box', ...(props.style || {}) }}>{props.children}</span>;
    const TouchableOpacity = (props) => <button {...props} className={props.className || ''} style={{ cursor: 'pointer', border: 'none', background: 'transparent', ...(props.style || {}) }} onClick={props.onPress || props.onClick}>{props.children}</button>;
    const TextInput = (props) => <input {...props} className={props.className || ''} style={{ boxSizing: 'border-box', ...(props.style || {}) }} onChange={(e) => props.onChangeText ? props.onChangeText(e.target.value) : (props.onChange && props.onChange(e))} />;
    const ScrollView = (props) => <div {...props} className={'overflow-y-auto ' + (props.className || '')} style={{ boxSizing: 'border-box', overflowY: 'auto', ...(props.style || {}) }}>{props.children}</div>;
    const Image = (props) => <img {...props} src={props.source?.uri || props.src || ''} className={props.className || ''} style={{ boxSizing: 'border-box', ...(props.style || {}) }} />;
    const SafeAreaView = View;
    const StatusBar = () => null;
    const StyleSheet = { create: (s) => s };

    window.onerror = function(msg, url, line) {
      const errEl = document.getElementById('preview-error');
      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.textContent = 'Preview Error: ' + msg + (line ? ' (Line: ' + line + ')' : '');
      }
      return false;
    };

    try {
      ${sanitizedCode}

      let ComponentToRender = null;
      if (typeof App !== 'undefined') {
        ComponentToRender = App;
      } else if (typeof __defaultExport !== 'undefined') {
        ComponentToRender = __defaultExport;
      }

      if (ComponentToRender) {
        ReactDOM.createRoot(document.getElementById('root')).render(<ComponentToRender />);
      } else {
        document.getElementById('root').innerHTML = '<div class="p-8 text-center text-amber-400 font-bold">Workspace Ready</div>';
      }

      if (window.lucide) {
        setTimeout(() => window.lucide.createIcons(), 100);
      }
    } catch (err) {
      const errEl = document.getElementById('preview-error');
      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.textContent = 'Runtime Exception: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
}
