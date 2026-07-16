const fs = require('fs');
const path = require('path');

function buildJs(partsDir, outputFile) {
    if (!fs.existsSync(partsDir)) return;
    const files = fs.readdirSync(partsDir).filter(f => f.endsWith('.js')).sort();
    
    // JS files have an IIFE start in app-01 and end in app-15.
    // They just need to be concatenated in order.
    const bundle = files.map(f => fs.readFileSync(path.join(partsDir, f), 'utf-8')).join('\n\n');
    fs.writeFileSync(outputFile, bundle);
    console.log(`[JS] Bundle construido: ${outputFile} (${files.length} archivos)`);
}

function buildCss(inputFile, outputFile) {
    if (!fs.existsSync(inputFile)) return;
    let css = fs.readFileSync(inputFile, 'utf-8');
    css = css.replace(/^\uFEFF/, '');
    
    const bundle = css.replace(/@import url\("([^"]+)"\);/g, (match, filepath) => {
        const fullPath = path.resolve(path.dirname(inputFile), filepath);
        if (fs.existsSync(fullPath)) {
            let fileContent = fs.readFileSync(fullPath, 'utf-8');
            fileContent = fileContent.replace(/^\uFEFF/, '');
            return `/* --- ${filepath} --- */\n` + fileContent + '\n';
        }
        console.warn(`[WARN] Archivo CSS no encontrado: ${fullPath}`);
        return match;
    });
    
    fs.writeFileSync(outputFile, bundle);
    console.log(`[CSS] Bundle construido: ${outputFile}`);
}

// Ejecutar build
console.log('Iniciando empaquetado...');
buildJs('app.parts', 'app.bundle.js');
buildCss('styles.css', 'styles.bundle.css');
buildCss('leia-styles.css', 'leia-styles.bundle.css');
buildCss('widget.css', 'widget.bundle.css');
console.log('¡Construcción terminada!');
