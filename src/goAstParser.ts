import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { promisify } from 'util';

const execFile = promisify(cp.execFile);

// Go AST解析器结果接口
export interface GoAstResult {
    packages: {
        [path: string]: {
            path: string;
            name: string;
            interfaces: InterfaceInfo[];
            structs: StructInfo[];
            methods: ImplementationInfo[];
        }
    };
}

// 接口方法信息
export interface MethodInfo {
    name: string;
    line: number;
    filePath: string;
}

// 接口信息
export interface InterfaceInfo {
    name: string;
    line: number;
    filePath: string;
    methods: MethodInfo[];
    internalType?: string; // 嵌入的接口类型
}

// 字段信息
export interface FieldInfo {
    name: string;
    type: string;
    line: number;
    filePath: string;
    embedded: boolean;
    isPointer: boolean;
}

// 结构体信息
export interface StructInfo {
    name: string;
    line: number;
    filePath: string;
    fields: FieldInfo[];
}

// 方法实现信息
export interface ImplementationInfo {
    receiverType: string;
    methodName: string;
    line: number;
    filePath: string;
    isPointer: boolean;
}

export class GoAstParser {
    private parserPath: string;
    private parseCache = new Map<string, GoAstResult>();
    private fileCache = new Map<string, GoAstResult>(); // 文件级别缓存，用于快速访问
    private packageCache = new Map<string, string>(); // 文件路径到包路径的映射
    private cacheTimeToLive: number = 300000; // 5分钟缓存
    private fileCacheTimeToLive: number = 30000; // 30秒文件缓存
    private cacheTimes = new Map<string, number>();
    private fileCacheTimes = new Map<string, number>();
    private isParserReady: boolean = false;

    constructor(extensionPath: string) {
        this.parserPath = path.join(extensionPath, 'src', 'parser', 'goparser.go');
    }

    /**
     * 确保Go解析器可用
     */
    public async ensureParserReady(): Promise<boolean> {
        if (this.isParserReady) {
            return true;
        }
        
        const parserDir = path.dirname(this.parserPath);
        const parserBin = path.join(parserDir, 'parser');
        
        // 同时检查输出目录中的解析器
        const extensionRoot = path.resolve(parserDir, '..', '..');
        const outParserDir = path.join(extensionRoot, 'out', 'parser');
        const outParserBin = path.join(outParserDir, 'parser');
        
        console.log(`[IJump] 检查Go解析器路径: ${parserBin}`);
        console.log(`[IJump] 检查输出目录解析器路径: ${outParserBin}`);
        console.log(`[IJump] 源码路径: ${this.parserPath}`);

        try {
            // 首先检查预编译的解析器是否存在
            let parserExists = fs.existsSync(parserBin);
            let actualParserBin = parserBin;
            
            // 如果源目录中没有解析器，检查输出目录
            if (!parserExists && fs.existsSync(outParserBin)) {
                console.log('[IJump] 在源目录未找到解析器，使用输出目录中的版本');
                parserExists = true;
                actualParserBin = outParserBin;
                
                // 如果需要，将输出目录中的解析器复制到源目录
                try {
                    fs.mkdirSync(parserDir, { recursive: true });
                    fs.copyFileSync(outParserBin, parserBin);
                    console.log(`[IJump] 已将解析器从输出目录复制到源目录: ${parserBin}`);
                    actualParserBin = parserBin;
                } catch (copyError) {
                    console.warn('[IJump] 无法复制解析器到源目录，将使用输出目录中的版本');
                }
            }
            
            if (parserExists) {
                console.log(`[IJump] 找到预编译的Go解析器: ${actualParserBin}`);
                
                // 检查可执行权限
                try {
                    fs.accessSync(actualParserBin, fs.constants.X_OK);
                    console.log('[IJump] 解析器具有执行权限');
                } catch (permError) {
                    console.warn('[IJump] 解析器缺少执行权限，尝试添加权限');
                    try {
                        // 尝试添加执行权限 (仅适用于类Unix系统)
                        if (process.platform !== 'win32') {
                            await execFile('chmod', ['+x', actualParserBin]);
                            console.log('[IJump] 已添加执行权限');
                        }
                    } catch (chmodError: any) {
                        console.error('[IJump] 无法添加执行权限:', chmodError.message);
                        // 继续尝试，可能在某些环境中不需要显式权限
                    }
                }
                
                this.isParserReady = true;
                return true;
            }
            
            // 如果找不到预编译的解析器，尝试编译
            // 检查Go环境
            console.log('[IJump] 未找到预编译解析器，检查Go环境...');
            try {
                const { stdout: goVersion } = await execFile('go', ['version']);
                console.log(`[IJump] Go版本: ${goVersion.trim()}`);
            } catch (goError: any) {
                console.error('[IJump] 无法检测Go环境，请确保Go已安装并在PATH中:', goError.message);
                return false;
            }
            
            // 尝试编译解析器
            console.log('[IJump] 尝试编译Go解析器...');
            try {
                await execFile('go', ['build', '-o', parserBin, this.parserPath], {
                    cwd: parserDir
                });
                console.log('[IJump] Go解析器编译成功');
                
                // 再次检查文件是否正确创建
                if (!fs.existsSync(parserBin)) {
                    console.error('[IJump] 编译似乎成功但未找到输出文件');
                    return false;
                }
                
                // 确保输出目录存在并复制解析器
                try {
                    fs.mkdirSync(outParserDir, { recursive: true });
                    fs.copyFileSync(parserBin, outParserBin);
                    console.log(`[IJump] 已将编译的解析器复制到输出目录: ${outParserBin}`);
                    
                    // 确保复制的文件有执行权限
                    if (process.platform !== 'win32') {
                        await execFile('chmod', ['+x', outParserBin]);
                    }
                } catch (copyError: any) {
                    console.warn('[IJump] 无法复制解析器到输出目录:', copyError.message);
                }
                
                this.isParserReady = true;
                return true;
            } catch (compileError: any) {
                console.error('[IJump] Go解析器编译失败:', compileError.message);
                if (compileError.stderr) {
                    console.error('[IJump] 编译错误详情:', compileError.stderr);
                }
                console.log('[IJump] 当前工作目录:', parserDir);
                console.log('[IJump] 执行命令:', `go build -o ${parserBin} ${this.parserPath}`);
                return false;
            }
        } catch (error: any) {
            console.error('[IJump] 意外错误:', error.message);
            return false;
        }
    }

    /**
     * 获取包路径 - 提取文件所在目录路径
     */
    private getPackagePath(filePath: string): string {
        return path.dirname(filePath);
    }

    /**
     * 解析Go文件及其相关包，优先使用文件缓存，提高显示速度
     */
    public async parseGoFile(filePath: string): Promise<GoAstResult> {
        const now = Date.now();
        
        // 1. 首先尝试使用文件级别缓存 - 快速路径
        if (this.fileCache.has(filePath)) {
            const cacheTime = this.fileCacheTimes.get(filePath) || 0;
            if (now - cacheTime < this.fileCacheTimeToLive) {
                console.log(`[IJump] 使用文件级缓存: ${filePath}`);
                return this.fileCache.get(filePath)!;
            }
        }
        
        // 2. 尝试包级别缓存 - 中等路径
        const packagePath = this.getPackagePath(filePath);
        const cacheKey = packagePath;
        
        // 记录文件到包的映射
        this.packageCache.set(filePath, packagePath);
        
        if (this.parseCache.has(cacheKey)) {
            const cacheTime = this.cacheTimes.get(cacheKey) || 0;
            if (now - cacheTime < this.cacheTimeToLive) {
                const result = this.parseCache.get(cacheKey)!;
                
                // 更新文件级缓存，为下次更快访问
                this.fileCache.set(filePath, result);
                this.fileCacheTimes.set(filePath, now);
                
                console.log(`[IJump] 使用包级缓存: ${packagePath} 对文件: ${filePath}`);
                return result;
            }
        }

        // 3. 没有有效缓存，解析文件 - 慢路径
        try {
            console.log(`[IJump] 解析文件: ${filePath}`);

            // 确保解析器就绪
            if (!await this.ensureParserReady()) {
                console.error('[IJump] Go解析器未就绪，无法解析文件');
                console.error('[IJump] 将使用空结果继续，界面功能可能受限');
                return { packages: {} };
            }
            
            const parserDir = path.dirname(this.parserPath);
            const parserBin = path.join(parserDir, 'parser');
            
            // 检查文件是否存在
            if (!fs.existsSync(filePath)) {
                console.error(`[IJump] 文件不存在: ${filePath}`);
                return { packages: {} };
            }
            
            // 调用解析器
            try {
                console.log(`[IJump] 执行解析器: ${parserBin} ${filePath}`);
                const { stdout } = await execFile(parserBin, [filePath]);
                
                // 解析JSON
                try {
                    const result = JSON.parse(stdout) as GoAstResult;
                    
                    // 检查结果是否有效
                    if (!result || !result.packages) {
                        console.error('[IJump] 解析结果无效');
                        return { packages: {} };
                    }
                    
                    // 检查是否找到了包信息
                    const packageCount = Object.keys(result.packages).length;
                    
                    if (packageCount > 0) {
                        // 更新包级缓存
                        this.parseCache.set(cacheKey, result);
                        this.cacheTimes.set(cacheKey, now);
                        
                        // 同时更新文件级缓存
                        this.fileCache.set(filePath, result);
                        this.fileCacheTimes.set(filePath, now);
                        
                        console.log(`[IJump] 解析成功，已缓存，找到 ${packageCount} 个包`);
                    } else {
                        console.warn(`[IJump] 未找到包信息: ${packagePath}`);
                    }
    
                    return result;
                } catch (jsonError: any) {
                    console.error('[IJump] JSON解析失败:', jsonError.message);
                    console.error('[IJump] 解析器输出:', stdout.substring(0, 200) + (stdout.length > 200 ? '...' : ''));
                    return { packages: {} };
                }
            } catch (execError: any) {
                console.error('[IJump] 执行Go解析器失败:', execError.message);
                if (execError.stderr) {
                    console.error('[IJump] 解析器错误输出:', execError.stderr);
                }
                return { packages: {} };
            }
        } catch (error: any) {
            const errorMsg = `[IJump] 解析失败: ${filePath} - ${error.message}`;
            console.error(errorMsg);
            // 返回空结果而不是抛出异常
            return {
                packages: {}
            };
        }
    }

    /**
     * 清除特定文件或包的缓存
     */
    public clearCache(filePath?: string): void {
        if (filePath) {
            // 清除文件缓存
            this.fileCache.delete(filePath);
            this.fileCacheTimes.delete(filePath);
            
            // 清除包缓存
            const packagePath = this.packageCache.get(filePath) || this.getPackagePath(filePath);
            this.parseCache.delete(packagePath);
            this.cacheTimes.delete(packagePath);
            console.log(`已清除缓存: ${filePath}`);
        } else {
            // 清除所有缓存
            this.fileCache.clear();
            this.fileCacheTimes.clear();
            this.parseCache.clear();
            this.cacheTimes.clear();
            console.log('已清除所有缓存');
        }
    }

    /**
     * 获取接口的所有方法
     */
    public getInterfaceMethods(result: GoAstResult): Map<string, string[]> {
        const interfaceMethodsMap = new Map<string, string[]>();
        
        for (const packagePath in result.packages) {
            const pkg = result.packages[packagePath];
            
            for (const iface of pkg.interfaces) {
                const methods: string[] = [];
                
                // 添加接口自身的方法
                for (const method of iface.methods) {
                    methods.push(method.name);
                }
                
                interfaceMethodsMap.set(iface.name, methods);
            }
        }
        
        return interfaceMethodsMap;
    }

    /**
     * 获取接口及其方法的位置信息
     */
    public getInterfaceLocations(result: GoAstResult): Map<string, Map<string, { line: number, uri: vscode.Uri }>> {
        const interfaceLocationsMap = new Map<string, Map<string, { line: number, uri: vscode.Uri }>>();
        
        for (const packagePath in result.packages) {
            const pkg = result.packages[packagePath];
            
            for (const iface of pkg.interfaces) {
                if (!interfaceLocationsMap.has(iface.name)) {
                    interfaceLocationsMap.set(iface.name, new Map());
                }
                
                const methodLocations = interfaceLocationsMap.get(iface.name)!;
                
                // 存储接口定义位置
                methodLocations.set('__interface_def__', {
                    line: iface.line,
                    uri: vscode.Uri.file(iface.filePath)
                });
                
                // 存储方法位置
                for (const method of iface.methods) {
                    methodLocations.set(method.name, {
                        line: method.line,
                        uri: vscode.Uri.file(method.filePath)
                    });
                }
            }
        }
        
        return interfaceLocationsMap;
    }

    /**
     * 获取结构体方法的实现信息
     */
    public getImplementations(result: GoAstResult): Map<string, Map<string, { line: number, uri: vscode.Uri }>> {
        const structMethodsMap = new Map<string, Map<string, { line: number, uri: vscode.Uri }>>();
        
        for (const packagePath in result.packages) {
            const pkg = result.packages[packagePath];
            
            // 处理方法实现
            for (const method of pkg.methods) {
                if (!structMethodsMap.has(method.receiverType)) {
                    structMethodsMap.set(method.receiverType, new Map());
                }
                
                structMethodsMap.get(method.receiverType)!.set(method.methodName, {
                    line: method.line,
                    uri: vscode.Uri.file(method.filePath)
                });
            }
            
            // 处理结构体定义
            for (const struct of pkg.structs) {
                if (!structMethodsMap.has(struct.name)) {
                    structMethodsMap.set(struct.name, new Map());
                }
                
                // 存储结构体定义位置
                structMethodsMap.get(struct.name)!.set('__struct_def__', {
                    line: struct.line,
                    uri: vscode.Uri.file(struct.filePath)
                });
            }
        }
        
        return structMethodsMap;
    }

    /**
     * 获取结构体信息
     */
    public getStructsInfo(result: GoAstResult, interfaceNames: Set<string>): Map<string, Map<string, any>> {
        const structsMap = new Map<string, Map<string, any>>();
        
        for (const packagePath in result.packages) {
            const pkg = result.packages[packagePath];
            
            for (const struct of pkg.structs) {
                const structInfo = new Map<string, any>();
                structInfo.set('line', struct.line);
                structInfo.set('uri', vscode.Uri.file(struct.filePath));
                structInfo.set('fields', new Map<string, any>());
                
                // 处理结构体字段
                for (const field of struct.fields) {
                    structInfo.get('fields').set(field.name, {
                        type: field.type,
                        line: field.line,
                        uri: vscode.Uri.file(field.filePath),
                        embedded: field.embedded
                    });
                }
                
                structsMap.set(struct.name, structInfo);
            }
        }
        
        // 查找接口实现注释标记
        this.findInterfaceImplementationMarkers(result, structsMap);
        
        return structsMap;
    }

    /**
     * 查找接口实现的注释标记
     */
    private findInterfaceImplementationMarkers(result: GoAstResult, structsMap: Map<string, Map<string, any>>): void {
        // 在真实环境中需要解析注释
        // 此处使用简化实现，可以根据需要扩展
    }

    /**
     * 获取所有接口名称
     */
    public getAllInterfaceNames(result: GoAstResult): Set<string> {
        const interfaceNames = new Set<string>();
        
        for (const packagePath in result.packages) {
            const pkg = result.packages[packagePath];
            
            for (const iface of pkg.interfaces) {
                interfaceNames.add(iface.name);
            }
        }
        
        return interfaceNames;
    }

    /**
     * 检查哪些结构体实现了接口
     */
    public checkInterfaceImplementations(
        interfaceMethodsMap: Map<string, string[]>,
        structMethodsMap: Map<string, Map<string, any>>,
        structsMap?: Map<string, Map<string, any>>
    ): Set<string> {
        const implementedInterfaces = new Set<string>();
        // 记录实现每个接口的结构体
        const interfaceImplementations = new Map<string, Set<string>>();
        
        // 创建一个帮助函数，用于添加接口实现关系
        const addImplementation = (interfaceName: string, structName: string) => {
            implementedInterfaces.add(interfaceName);
            
            if (!interfaceImplementations.has(interfaceName)) {
                interfaceImplementations.set(interfaceName, new Set<string>());
            }
            interfaceImplementations.get(interfaceName)?.add(structName);
        };
        
        // 处理显式声明的接口实现关系
        if (structsMap) {
            for (const [structName, structInfo] of structsMap.entries()) {
                if (structInfo.has('implementsInterfaces')) {
                    const implementsInterfaces = structInfo.get('implementsInterfaces');
                    for (const interfaceName of implementsInterfaces) {
                        if (interfaceMethodsMap.has(interfaceName)) {
                            addImplementation(interfaceName, structName);
                        }
                    }
                }
            }
        }
        
        // 检查方法名和数量匹配 - 分析每个结构体是否实现了接口的所有方法
        for (const [interfaceName, interfaceMethods] of interfaceMethodsMap.entries()) {
            // 跳过空接口或已确认实现的接口
            if (interfaceMethods.length === 0 || implementedInterfaces.has(interfaceName)) {
                continue;
            }
            
            // 对每个结构体检查方法匹配度
            for (const [structName, structMethods] of structMethodsMap.entries()) {
                // 跳过特殊标记和已知实现该接口的结构体
                if (structName.startsWith('__') && structName.endsWith('__') || 
                    (interfaceImplementations.has(interfaceName) && 
                     interfaceImplementations.get(interfaceName)?.has(structName))) {
                    continue;
                }
                
                // 将结构体定义的所有方法名收集到一个集合中
                const structMethodNames = new Set<string>();
                for (const methodName of structMethods.keys()) {
                    if (!methodName.startsWith('__')) {
                        structMethodNames.add(methodName);
                    }
                }
                
                // 计算结构体实现了多少接口所需的方法
                let implementedMethodCount = 0;
                for (const method of interfaceMethods) {
                    if (structMethodNames.has(method)) {
                        implementedMethodCount++;
                    }
                }
                
                // 计算实现率
                const implementationRate = interfaceMethods.length > 0 ? 
                    implementedMethodCount / interfaceMethods.length : 0;
                
                // 只有完全匹配才标记为实现，移除高匹配率条件
                const perfectMatch = implementationRate === 1.0;
                
                if (perfectMatch) {
                    addImplementation(interfaceName, structName);
                }
            }
        }
        
        // 检查间接实现（通过组合或嵌入）
        if (structsMap) {
            let hasNewImplementation = true;
            let iterations = 0;
            const maxIterations = 5; // 增加迭代次数以处理更复杂的嵌套关系
            
            while (hasNewImplementation && iterations < maxIterations) {
                hasNewImplementation = false;
                iterations++;
                
                for (const [structName, structInfo] of structsMap.entries()) {
                    // 跳过没有字段的结构体
                    if (!structInfo.has('fields')) {
                        continue;
                    }
                    
                    const fields = structInfo.get('fields');
                    if (!fields || fields.size === 0) {
                        continue;
                    }
                    
                    // 检查每个字段，关注嵌入字段
                    for (const [fieldName, fieldInfo] of fields.entries()) {
                        // 只关注嵌入字段
                        if (!fieldInfo.embedded) {
                            continue;
                        }
                        
                        const fieldType = fieldInfo.type;
                        
                        // 检查字段类型是否直接实现了某个接口
                        for (const [interfaceName, implementingStructs] of interfaceImplementations.entries()) {
                            // 如果字段类型实现了接口，或者字段类型就是接口类型
                            if (implementingStructs.has(fieldType) || interfaceName === fieldType) {
                                // 如果结构体还没有被标记为实现了该接口
                                if (!interfaceImplementations.has(interfaceName) || 
                                    !interfaceImplementations.get(interfaceName)?.has(structName)) {
                                    
                                    addImplementation(interfaceName, structName);
                                    hasNewImplementation = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 检查指针接收器的方法 - 特别处理可能存在于其他文件中的方法
        for (const [interfaceName, interfaceMethods] of interfaceMethodsMap.entries()) {
            if (interfaceMethods.length === 0 || implementedInterfaces.has(interfaceName)) {
                continue;
            }
            
            // 查找所有以'*'开头的接收器类型，这些是指针接收器
            const pointerReceivers = new Set<string>();
            for (const [receiverType, methods] of structMethodsMap.entries()) {
                if (receiverType.startsWith('*')) {
                    pointerReceivers.add(receiverType.substring(1)); // 去掉*号
                }
            }
            
            // 检查每个接口的实现
            for (const structName of pointerReceivers) {
                if (structMethodsMap.has(structName) || structMethodsMap.has('*' + structName)) {
                    // 收集结构体的所有方法（包括指针方法和值方法）
                    const allStructMethods = new Set<string>();
                    
                    // 添加值接收器的方法
                    if (structMethodsMap.has(structName)) {
                        for (const methodName of structMethodsMap.get(structName)!.keys()) {
                            if (!methodName.startsWith('__')) {
                                allStructMethods.add(methodName);
                            }
                        }
                    }
                    
                    // 添加指针接收器的方法
                    if (structMethodsMap.has('*' + structName)) {
                        for (const methodName of structMethodsMap.get('*' + structName)!.keys()) {
                            if (!methodName.startsWith('__')) {
                                allStructMethods.add(methodName);
                            }
                        }
                    }
                    
                    // 检查结构体是否实现了接口所有的方法
                    let implementedMethodCount = 0;
                    for (const method of interfaceMethods) {
                        if (allStructMethods.has(method)) {
                            implementedMethodCount++;
                        }
                    }
                    
                    // 计算实现率
                    const implementationRate = interfaceMethods.length > 0 ? 
                        implementedMethodCount / interfaceMethods.length : 0;
                    
                    // 只有完全匹配才标记为实现，移除高匹配率条件
                    const perfectMatch = implementationRate === 1.0;
                    
                    if (perfectMatch) {
                        addImplementation(interfaceName, structName);
                    }
                }
            }
        }
        
        return implementedInterfaces;
    }
} 