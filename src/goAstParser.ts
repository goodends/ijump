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
    private cacheTimeToLive: number = 30000; // 30秒缓存有效期
    private cacheTimes = new Map<string, number>();

    constructor(extensionPath: string) {
        this.parserPath = path.join(extensionPath, 'src', 'parser', 'goparser.go');
    }

    /**
     * 解析Go文件及其相关包
     */
    public async parseGoFile(filePath: string): Promise<GoAstResult> {
        const now = Date.now();
        const cacheKey = filePath;

        // 检查缓存
        if (this.parseCache.has(cacheKey)) {
            const cacheTime = this.cacheTimes.get(cacheKey) || 0;
            if (now - cacheTime < this.cacheTimeToLive) {
                console.log(`使用缓存的Go解析结果: ${filePath}`);
                return this.parseCache.get(cacheKey)!;
            }
        }

        try {
            console.log(`开始解析Go文件: ${filePath}`);

            // 获取Go解析器的目录
            const parserDir = path.dirname(this.parserPath);
            const parserBin = path.join(parserDir, 'parser');
            
            // 首先检查解析器是否已编译
            if (!fs.existsSync(parserBin)) {
                // 首次运行时编译解析器
                console.log('编译Go解析器...');
                try {
                    await execFile('go', ['build', '-o', parserBin, this.parserPath], {
                        cwd: parserDir
                    });
                    console.log('Go解析器编译完成');
                } catch (compileError: any) {
                    console.error('Go解析器编译失败:', compileError.message);
                    if (compileError.stderr) {
                        console.error('编译错误详情:', compileError.stderr);
                    }
                    throw new Error(`Go解析器编译失败: ${compileError.message}`);
                }
            }
            
            // 调用编译好的解析器
            try {
                const { stdout } = await execFile(parserBin, [filePath]);
                
                // 尝试解析JSON
                try {
                    const result = JSON.parse(stdout) as GoAstResult;
                    
                    // 检查结果是否有效
                    if (!result || !result.packages) {
                        throw new Error('解析结果无效');
                    }
                    
                    // 更新缓存
                    this.parseCache.set(cacheKey, result);
                    this.cacheTimes.set(cacheKey, now);
    
                    console.log(`成功解析Go文件: ${filePath}`);
                    return result;
                } catch (jsonError) {
                    console.error('JSON解析失败:', jsonError);
                    console.error('原始输出:', stdout);
                    throw new Error(`无法解析Go解析器的输出: ${jsonError}`);
                }
            } catch (execError: any) {
                console.error('执行Go解析器失败:', execError.message);
                if (execError.stderr) {
                    console.error('执行错误详情:', execError.stderr);
                }
                throw new Error(`执行Go解析器失败: ${execError.message}`);
            }
        } catch (error: any) {
            const errorMsg = `解析Go文件失败: ${filePath}, ${error.message || error}`;
            console.error(errorMsg);
            // 返回一个空结果而不是抛出异常，这样界面不会崩溃
            return {
                packages: {}
            };
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
        const interfaceImplementations = new Map<string, Set<string>>();
        
        // 处理显式声明的接口实现关系
        if (structsMap) {
            for (const [structName, structInfo] of structsMap.entries()) {
                if (structInfo.has('implementsInterfaces')) {
                    const implementsInterfaces = structInfo.get('implementsInterfaces');
                    for (const interfaceName of implementsInterfaces) {
                        if (interfaceMethodsMap.has(interfaceName)) {
                            implementedInterfaces.add(interfaceName);
                            
                            if (!interfaceImplementations.has(interfaceName)) {
                                interfaceImplementations.set(interfaceName, new Set<string>());
                            }
                            interfaceImplementations.get(interfaceName)?.add(structName);
                        }
                    }
                }
            }
        }
        
        // 检查方法名和数量匹配
        for (const [interfaceName, interfaceMethods] of interfaceMethodsMap.entries()) {
            if (implementedInterfaces.has(interfaceName)) {
                continue;
            }
            
            // 跳过空接口
            if (interfaceMethods.length === 0) {
                continue;
            }
            
            // 对每个结构体检查方法匹配度
            for (const [structName, structMethods] of structMethodsMap.entries()) {
                if (structName.startsWith('__') && structName.endsWith('__')) {
                    continue;
                }
                
                let implementedMethodCount = 0;
                const structMethodNames = new Set<string>();
                
                for (const methodName of structMethods.keys()) {
                    if (!methodName.startsWith('__')) {
                        structMethodNames.add(methodName);
                    }
                }
                
                for (const method of interfaceMethods) {
                    if (structMethodNames.has(method)) {
                        implementedMethodCount++;
                    }
                }
                
                const implementationRate = interfaceMethods.length > 0 ? 
                    implementedMethodCount / interfaceMethods.length : 0;
                
                // 完全匹配 100%
                const perfectMatch = implementationRate === 1.0;
                
                // 高匹配 至少 80%
                const highMatch = implementationRate >= 0.8;
                
                if (perfectMatch || highMatch) {
                    implementedInterfaces.add(interfaceName);
                    
                    if (!interfaceImplementations.has(interfaceName)) {
                        interfaceImplementations.set(interfaceName, new Set<string>());
                    }
                    interfaceImplementations.get(interfaceName)?.add(structName);
                    
                    if (perfectMatch) {
                        break;
                    }
                }
            }
        }
        
        // 检查间接实现（通过组合或嵌入）
        if (structsMap) {
            let hasNewImplementation = true;
            let iterations = 0;
            
            while (hasNewImplementation && iterations < 3) {
                hasNewImplementation = false;
                iterations++;
                
                for (const [structName, structInfo] of structsMap.entries()) {
                    const fields = structInfo.get('fields');
                    
                    for (const [fieldName, fieldInfo] of fields.entries()) {
                        const fieldType = fieldInfo.type;
                        
                        for (const [interfaceName, implementingStructs] of interfaceImplementations.entries()) {
                            if (implementingStructs.has(fieldType) || interfaceName === fieldType) {
                                if (!implementedInterfaces.has(interfaceName) || 
                                    !interfaceImplementations.get(interfaceName)?.has(structName)) {
                                    
                                    implementedInterfaces.add(interfaceName);
                                    
                                    if (!interfaceImplementations.has(interfaceName)) {
                                        interfaceImplementations.set(interfaceName, new Set<string>());
                                    }
                                    interfaceImplementations.get(interfaceName)?.add(structName);
                                    
                                    hasNewImplementation = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        return implementedInterfaces;
    }
} 