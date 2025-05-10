/**
 * 预编译Go解析器的脚本
 * 该脚本会在插件打包前执行，确保二进制文件已经预先编译好
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 获取关键路径
const rootDir = path.resolve(__dirname, '..');
const parserDir = path.join(rootDir, 'src', 'parser');
const goSourceFile = path.join(parserDir, 'goparser.go');
const parserBin = path.join(parserDir, 'parser');
const outDir = path.join(rootDir, 'out', 'parser');

console.log('[build-parser] 开始预编译Go解析器...');

// 检查源文件是否存在
if (!fs.existsSync(goSourceFile)) {
    console.error(`[build-parser] 错误: 源文件不存在: ${goSourceFile}`);
    process.exit(1);
}

// 检查Go环境
try {
    const goVersion = execSync('go version').toString().trim();
    console.log(`[build-parser] 检测到Go环境: ${goVersion}`);
} catch (error) {
    console.error('[build-parser] 错误: 未安装Go或无法访问go命令');
    console.error('[build-parser] 请确保Go已正确安装并在PATH中');
    process.exit(1);
}

// 编译当前平台版本
try {
    console.log(`[build-parser] 为当前平台编译解析器...`);
    execSync(`go build -o "${parserBin}" "${goSourceFile}"`, {
        cwd: parserDir,
        stdio: 'inherit'
    });
    
    // 确保文件已创建
    if (fs.existsSync(parserBin)) {
        console.log(`[build-parser] 成功编译解析器: ${parserBin}`);
        
        // 确保文件有执行权限
        if (process.platform !== 'win32') {
            execSync(`chmod +x "${parserBin}"`);
            console.log('[build-parser] 已添加执行权限');
        }
        
        // 确保输出目录存在
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
            console.log(`[build-parser] 创建输出目录: ${outDir}`);
        }
        
        // 复制解析器到输出目录
        const outParserBin = path.join(outDir, path.basename(parserBin));
        fs.copyFileSync(parserBin, outParserBin);
        console.log(`[build-parser] 已复制解析器到输出目录: ${outParserBin}`);
        
        // 确保复制的文件有执行权限
        if (process.platform !== 'win32') {
            execSync(`chmod +x "${outParserBin}"`);
        }
    } else {
        console.error(`[build-parser] 错误: 编译似乎成功但未找到输出文件`);
        process.exit(1);
    }
} catch (error) {
    console.error('[build-parser] 编译失败:', error.message);
    process.exit(1);
}

console.log('[build-parser] Go解析器预编译完成'); 