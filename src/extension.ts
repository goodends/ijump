// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

// 定义接口用于记录方法信息
interface MethodInfo {
	name: string;
	line: number;
	type: 'interface' | 'implementation';
}

// 添加新的接口用于存储文件信息
interface GoFileInfo {
	uri: vscode.Uri;
	packageName: string;
	content: string;
}

// 定义装饰类
class DecorationManager {
	private interfaceDecorationType: vscode.TextEditorDecorationType;
	private implementationDecorationType: vscode.TextEditorDecorationType;
	
	constructor(context: vscode.ExtensionContext) {
		const interfaceIconPath = path.join(context.extensionPath, 'resources', 'interface.svg');
		const implementationIconPath = path.join(context.extensionPath, 'resources', 'implementation.svg');
		
		// 接口方法装饰（跳转到实现）
		this.interfaceDecorationType = vscode.window.createTextEditorDecorationType({
			gutterIconPath: interfaceIconPath,
			gutterIconSize: '60%',
			isWholeLine: false
		});
		
		// 实现方法装饰（跳转到接口）
		this.implementationDecorationType = vscode.window.createTextEditorDecorationType({
			gutterIconPath: implementationIconPath,
			gutterIconSize: '60%',
			isWholeLine: false
		});
	}
	
	// 获取接口装饰类型
	getInterfaceDecorationType(): vscode.TextEditorDecorationType {
		return this.interfaceDecorationType;
	}
	
	// 获取实现装饰类型
	getImplementationDecorationType(): vscode.TextEditorDecorationType {
		return this.implementationDecorationType;
	}
	
	// 应用装饰
	applyDecorations(editor: vscode.TextEditor, 
					  interfaceDecorations: vscode.DecorationOptions[], 
					  implementationDecorations: vscode.DecorationOptions[]) {
		editor.setDecorations(this.interfaceDecorationType, interfaceDecorations);
		editor.setDecorations(this.implementationDecorationType, implementationDecorations);
		console.log(`应用了 ${interfaceDecorations.length} 个接口装饰和 ${implementationDecorations.length} 个实现装饰`);
	}
}

// 代码解析器类
class GoCodeParser {
	private fileCache = new Map<string, GoFileInfo>();
	
	// 获取文件所在的包名
	private getPackageName(content: string): string {
		const packageMatch = content.match(/package\s+(\w+)/);
		return packageMatch ? packageMatch[1] : '';
	}
	
	// 获取同一包下的所有文件
	async getSamePackageFiles(document: vscode.TextDocument): Promise<GoFileInfo[]> {
		const text = document.getText();
		const packageName = this.getPackageName(text);
		if (!packageName) {
			return []; // 如果找不到包名，返回空数组
		}
		
		// 初始化缓存
		this.fileCache.set(document.uri.toString(), {
			uri: document.uri,
			packageName,
			content: text
		});
		
		// 获取当前文件所在目录
		const dirPath = document.uri.fsPath.substring(0, document.uri.fsPath.lastIndexOf('/'));
		
		try {
			// 查找同目录下的Go文件
			const dirUri = vscode.Uri.file(dirPath);
			const files = await vscode.workspace.fs.readDirectory(dirUri);
			
			const goFiles: GoFileInfo[] = [];
			
			// 处理所有Go文件
			for (const [fileName, fileType] of files) {
				if (fileType === vscode.FileType.File && fileName.endsWith('.go')) {
					const fileUri = vscode.Uri.joinPath(dirUri, fileName);
					const fileKey = fileUri.toString();
					
					// 检查缓存
					if (this.fileCache.has(fileKey)) {
						const cachedFile = this.fileCache.get(fileKey)!;
						if (cachedFile.packageName === packageName) {
							goFiles.push(cachedFile);
							continue;
						}
					}
					
					// 读取文件内容
					const fileData = await vscode.workspace.fs.readFile(fileUri);
					const fileContent = Buffer.from(fileData).toString('utf-8');
					const filePackage = this.getPackageName(fileContent);
					
					// 只处理同一包下的文件
					if (filePackage === packageName) {
						const fileInfo: GoFileInfo = {
							uri: fileUri,
							packageName: filePackage,
							content: fileContent
						};
						this.fileCache.set(fileKey, fileInfo);
						goFiles.push(fileInfo);
					}
				}
			}
			
			return goFiles;
		} catch (error) {
			console.error('读取目录失败:', error);
			// 如果读取目录失败，至少返回当前文件
			return [{
				uri: document.uri,
				packageName,
				content: text
			}];
		}
	}
	
	// 解析接口 - 跨文件版本
	async parseInterfaces(document: vscode.TextDocument): Promise<Map<string, string[]>> {
		const interfaceMethodsMap = new Map<string, string[]>();
		const packageFiles = await this.getSamePackageFiles(document);
		
		for (const fileInfo of packageFiles) {
			const text = fileInfo.content;
			const interfaceRegex = /type\s+(\w+)\s+interface\s*\{([^}]*)\}/gs;
			let interfaceMatch;
			
			while ((interfaceMatch = interfaceRegex.exec(text)) !== null) {
				const interfaceName = interfaceMatch[1];
				const interfaceContent = interfaceMatch[2];
				
				if (!interfaceMethodsMap.has(interfaceName)) {
					interfaceMethodsMap.set(interfaceName, []);
				}
				
				// 按行分割接口内容以更精确地处理每行
				const contentLines = interfaceContent.split('\n');
				for (const line of contentLines) {
					// 跳过空行和注释行
					if (!line.trim() || line.trim().startsWith('//')) {
						continue;
					}
					
					// 匹配方法定义: 函数名(参数)返回值
					// 改进的正则表达式，匹配更多种Go方法定义模式
					const methodMatch = line.match(/\s*([A-Za-z0-9_]+)\s*\(.*\)(?:\s*\(.*\)|\s+[\*\[\]A-Za-z0-9_,\s]+|\s*)?(?:\s*$)/);
					if (methodMatch) {
						const methodName = methodMatch[1];
						interfaceMethodsMap.get(interfaceName)?.push(methodName);
						console.log(`接口 ${interfaceName} 定义了方法 ${methodName}`);
					}
				}
			}
		}
		
		return interfaceMethodsMap;
	}
	
	// 解析接口位置 - 跨文件版本
	async parseInterfaceLocations(document: vscode.TextDocument): Promise<Map<string, Map<string, { line: number, uri: vscode.Uri }>>> {
		const interfaceLocationsMap = new Map<string, Map<string, { line: number, uri: vscode.Uri }>>();
		const packageFiles = await this.getSamePackageFiles(document);
		
		for (const fileInfo of packageFiles) {
			const text = fileInfo.content;
			const interfaceRegex = /type\s+(\w+)\s+interface\s*\{([^}]*)\}/gs;
			let interfaceMatch;
			
			while ((interfaceMatch = interfaceRegex.exec(text)) !== null) {
				const interfaceName = interfaceMatch[1];
				const interfaceStartPos = this.getPositionAt(fileInfo, interfaceMatch.index);
				const interfaceLine = interfaceStartPos.line;
				
				// 为接口创建方法位置映射
				if (!interfaceLocationsMap.has(interfaceName)) {
					interfaceLocationsMap.set(interfaceName, new Map());
				}
				const methodLocations = interfaceLocationsMap.get(interfaceName)!;
				methodLocations.set('__interface_def__', { line: interfaceLine, uri: fileInfo.uri }); // 存储接口定义行
				
				const interfaceContent = interfaceMatch[2];
				const contentLines = interfaceContent.split('\n');
				let lineOffset = this.getPositionAt(fileInfo, interfaceMatch.index + interfaceMatch[0].indexOf(interfaceContent)).line;
				
				for (const line of contentLines) {
					// 跳过空行和注释行
					if (!line.trim() || line.trim().startsWith('//')) {
						lineOffset++;
						continue;
					}
					
					// 匹配方法定义: 函数名(参数)返回值
					const methodMatch = line.match(/\s*([A-Za-z0-9_]+)\s*\([^)]*\)/);
					if (methodMatch) {
						const methodName = methodMatch[1];
						methodLocations.set(methodName, { line: lineOffset, uri: fileInfo.uri });
					}
					
					lineOffset++;
				}
			}
		}
		
		return interfaceLocationsMap;
	}
	
	// 解析方法实现 - 跨文件版本
	async parseImplementations(document: vscode.TextDocument): Promise<Map<string, Map<string, { line: number, uri: vscode.Uri }>>> {
		const structMethodsMap = new Map<string, Map<string, { line: number, uri: vscode.Uri }>>();
		const packageFiles = await this.getSamePackageFiles(document);
		
		for (const fileInfo of packageFiles) {
			const text = fileInfo.content;
			// 优化正则表达式，使其能匹配更多种方法实现格式
			// 匹配格式: func (receiver *Type) MethodName(params) (returns) { ... }
			const implementationRegex = /func\s+\(\s*\w+\s+\*?(\w+)\s*\)\s+([A-Za-z0-9_]+)\s*\([^)]*\)/g;
			let implMatch;
			
			while ((implMatch = implementationRegex.exec(text)) !== null) {
				const receiverType = implMatch[1];
				const methodName = implMatch[2];
				const methodPos = this.getPositionAt(fileInfo, implMatch.index);
				const methodLine = methodPos.line;
				
				if (!structMethodsMap.has(receiverType)) {
					structMethodsMap.set(receiverType, new Map());
				}
				
				structMethodsMap.get(receiverType)?.set(methodName, { 
					line: methodLine, 
					uri: fileInfo.uri 
				});
				
				console.log(`找到方法实现: ${receiverType}.${methodName} 在行 ${methodLine}`);
			}
			
			// 查找结构体定义，确保所有结构体都被记录
			const structDefRegex = /type\s+(\w+)\s+struct\s*\{/g;
			let structDefMatch;
			
			while ((structDefMatch = structDefRegex.exec(text)) !== null) {
				const structName = structDefMatch[1];
				const structPos = this.getPositionAt(fileInfo, structDefMatch.index);
				const structLine = structPos.line;
				
				// 确保结构体已经在映射中
				if (!structMethodsMap.has(structName)) {
					structMethodsMap.set(structName, new Map());
				}
				
				// 在映射中添加结构体定义位置
				structMethodsMap.get(structName)?.set('__struct_def__', {
					line: structLine,
					uri: fileInfo.uri
				});
				
				console.log(`找到结构体定义: ${structName} 在行 ${structLine}`);
			}
		}
		
		return structMethodsMap;
	}
	
	// 解析结构体 - 跨文件版本
	async parseStructs(document: vscode.TextDocument, interfaceNames: Set<string>): Promise<Map<string, Map<string, any>>> {
		const structsMap = new Map<string, Map<string, any>>();
		const packageFiles = await this.getSamePackageFiles(document);
		
		for (const fileInfo of packageFiles) {
			const text = fileInfo.content;
			const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/gs;
			let structMatch;
			
			while ((structMatch = structRegex.exec(text)) !== null) {
				const structName = structMatch[1];
				const structStartPos = this.getPositionAt(fileInfo, structMatch.index);
				const structLine = structStartPos.line;
				
				const structInfo = new Map<string, any>();
				structInfo.set('line', structLine);
				structInfo.set('uri', fileInfo.uri);
				structInfo.set('fields', new Map<string, {type: string, line: number, uri: vscode.Uri, embedded: boolean}>());
				
				const structContent = structMatch[2];
				const contentLines = structContent.split('\n');
				let lineOffset = this.getPositionAt(fileInfo, structMatch.index + structMatch[0].indexOf(structContent)).line;
				
				for (const line of contentLines) {
					// 跳过空行和注释行
					if (!line.trim() || line.trim().startsWith('//')) {
						lineOffset++;
						continue;
					}
					
					// 处理嵌入字段的情况：字段没有名称，直接是类型名（可能带*号）
					// 例如: UserRepository 或 *ServiceImpl
					const embeddedFieldMatch = line.match(/^\s*(\*?\w+)\s*$/);
					if (embeddedFieldMatch) {
						// 移除可能的指针标记(*)并获取类型名
						const rawType = embeddedFieldMatch[1];
						const fieldType = rawType.startsWith('*') ? rawType.substring(1) : rawType;
						
						// 使用类型名作为字段名（嵌入字段）
						structInfo.get('fields').set(fieldType, {
							type: fieldType,
							line: lineOffset,
							uri: fileInfo.uri,
							embedded: true
						});
						console.log(`结构体 ${structName} 嵌入了类型 ${fieldType}`);
						lineOffset++;
						continue;
					}
					
					// 处理普通字段: 字段名 类型
					// 例如: repo Repository 或 service *Service
					const fieldMatch = line.match(/\s*(\w+)\s+(\*?\w+)/);
					if (fieldMatch) {
						const fieldName = fieldMatch[1];
						// 移除可能的指针标记(*)
						const rawType = fieldMatch[2];
						const fieldType = rawType.startsWith('*') ? rawType.substring(1) : rawType;
						
						// 添加字段，无论它是否是接口类型
						structInfo.get('fields').set(fieldName, {
							type: fieldType,
							line: lineOffset,
							uri: fileInfo.uri,
							embedded: false
						});
						
						// 如果是已知接口类型，记录特殊标记
						if (interfaceNames.has(fieldType)) {
							console.log(`结构体 ${structName} 字段 ${fieldName} 引用了接口 ${fieldType}`);
						}
					}
					
					lineOffset++;
				}
				
				structsMap.set(structName, structInfo);
			}
			
			// 查找结构体实现接口的注释标记
			// 例如：// ensure redisRateLimiter implements RateLimiter
			// 或: // 确保 redisRateLimiter 实现 RateLimiter
			const implementsRegex = /\/\/\s*(?:ensure|确保)\s+(\w+)\s+(?:implements|实现)\s+(\w+)/g;
			let implementsMatch;
			
			while ((implementsMatch = implementsRegex.exec(text)) !== null) {
				const structName = implementsMatch[1];
				const interfaceName = implementsMatch[2];
				
				// 如果结构体已经在映射中，添加实现接口标记
				if (structsMap.has(structName)) {
					const structInfo = structsMap.get(structName)!;
					if (!structInfo.has('implementsInterfaces')) {
						structInfo.set('implementsInterfaces', new Set<string>());
					}
					
					const implementsInterfaces = structInfo.get('implementsInterfaces');
					implementsInterfaces.add(interfaceName);
					console.log(`通过注释标记找到 ${structName} 实现了接口 ${interfaceName}`);
				}
			}
		}
		
		return structsMap;
	}
	
	// 辅助方法：计算文件中某个偏移位置对应的行号和列号
	private getPositionAt(fileInfo: GoFileInfo, offset: number): vscode.Position {
		const textBefore = fileInfo.content.substring(0, offset);
		const lines = textBefore.split('\n');
		const line = lines.length - 1;
		const character = lines[lines.length - 1].length;
		return new vscode.Position(line, character);
	}
	
	// 获取所有接口名称 - 跨文件版本
	async getAllInterfaceNames(document: vscode.TextDocument): Promise<Set<string>> {
		const interfaceNames = new Set<string>();
		const packageFiles = await this.getSamePackageFiles(document);
		
		for (const fileInfo of packageFiles) {
			const text = fileInfo.content;
			const allInterfaceRegex = /type\s+(\w+)\s+interface\s*\{/g;
			let interfaceNameMatch;
			
			while ((interfaceNameMatch = allInterfaceRegex.exec(text)) !== null) {
				interfaceNames.add(interfaceNameMatch[1]);
			}
		}
		
		return interfaceNames;
	}
	
	// 检查结构体是否实现了接口 - 跨文件版本
	checkInterfaceImplementations(interfaceMethodsMap: Map<string, string[]>, 
								structMethodsMap: Map<string, Map<string, any>>,
								structsMap?: Map<string, Map<string, any>>): Set<string> {
		const implementedInterfaces = new Set<string>();
		
		// 保存每个接口被哪些结构体实现的映射
		const interfaceImplementations = new Map<string, Set<string>>();
		
		// 添加调试信息
		console.log(`检查接口实现关系 - 接口数量: ${interfaceMethodsMap.size}, 结构体数量: ${structMethodsMap.size}`);
		
		// 第1步：处理显式声明的接口实现关系（通过注释标记）
		if (structsMap) {
			for (const [structName, structInfo] of structsMap.entries()) {
				if (structInfo.has('implementsInterfaces')) {
					const implementsInterfaces = structInfo.get('implementsInterfaces');
					for (const interfaceName of implementsInterfaces) {
						if (interfaceMethodsMap.has(interfaceName)) {
							implementedInterfaces.add(interfaceName);
							
							// 记录实现关系
							if (!interfaceImplementations.has(interfaceName)) {
								interfaceImplementations.set(interfaceName, new Set<string>());
							}
							interfaceImplementations.get(interfaceName)?.add(structName);
							
							console.log(`通过注释标记确认 ${structName} 实现了接口 ${interfaceName}`);
						}
					}
				}
			}
		}
		
		// 第2步：检查方法名和数量匹配
		for (const [interfaceName, interfaceMethods] of interfaceMethodsMap.entries()) {
			// 如果已经确定了接口的实现，跳过
			if (implementedInterfaces.has(interfaceName)) {
				continue;
			}
			
			console.log(`检查接口: ${interfaceName}, 方法数量: ${interfaceMethods.length}`);
			
			// 跳过空接口
			if (interfaceMethods.length === 0) {
				console.log(`接口 ${interfaceName} 没有方法，跳过`);
				continue;
			}
			
			// 对每个结构体检查方法匹配度
			for (const [structName, structMethods] of structMethodsMap.entries()) {
				// 跳过特殊标记，如 __struct_def__
				if (structName.startsWith('__') && structName.endsWith('__')) {
					continue;
				}
				
				// 计算方法匹配数
				let implementedMethodCount = 0;
				const structMethodNames = new Set<string>();
				
				// 收集结构体方法名
				for (const methodName of structMethods.keys()) {
					if (!methodName.startsWith('__')) {  // 跳过特殊标记
						structMethodNames.add(methodName);
					}
				}
				
				// 检查接口方法是否都被实现
				for (const method of interfaceMethods) {
					if (structMethodNames.has(method)) {
						implementedMethodCount++;
					}
				}
				
				// 计算实现率
				const implementationRate = interfaceMethods.length > 0 ? 
					implementedMethodCount / interfaceMethods.length : 0;
				
				// 完全匹配: 100% 的方法都实现了
				const perfectMatch = implementationRate === 1.0;
				
				// 高匹配: 至少 80% 的方法都实现了
				const highMatch = implementationRate >= 0.8;
				
				// 如果是完全匹配或高匹配
				if (perfectMatch || highMatch) {
					implementedInterfaces.add(interfaceName);
					
					// 记录实现关系
					if (!interfaceImplementations.has(interfaceName)) {
						interfaceImplementations.set(interfaceName, new Set<string>());
					}
					interfaceImplementations.get(interfaceName)?.add(structName);
					
					console.log(`${structName} 实现了接口 ${interfaceName}，匹配率: ${(implementationRate * 100).toFixed(2)}%`);
					
					// 如果是完全匹配，无需继续检查其他结构体
					if (perfectMatch) {
						break;
					}
				}
			}
		}
		
		// 第3步：检查可能的间接实现（通过组合或嵌入其他实现接口的结构体）
		if (structsMap) {
			let hasNewImplementation = true;
			// 最多迭代3次，避免可能的循环依赖
			let iterations = 0;
			
			while (hasNewImplementation && iterations < 3) {
				hasNewImplementation = false;
				iterations++;
				
				// 遍历所有结构体，查找其字段中是否引用了已知实现接口的类型
				for (const [structName, structInfo] of structsMap.entries()) {
					const fields = structInfo.get('fields');
					
					for (const [fieldName, fieldInfo] of fields.entries()) {
						const fieldType = fieldInfo.type;
						
						// 遍历所有已实现的接口
						for (const [interfaceName, implementingStructs] of interfaceImplementations.entries()) {
							// 如果字段类型是已知实现该接口的结构体之一，则该结构体也间接实现了接口
							if (implementingStructs.has(fieldType) || interfaceName === fieldType) {
								// 如果这是新发现的实现关系
								if (!implementedInterfaces.has(interfaceName) || 
									!interfaceImplementations.get(interfaceName)?.has(structName)) {
									
									implementedInterfaces.add(interfaceName);
									
									if (!interfaceImplementations.has(interfaceName)) {
										interfaceImplementations.set(interfaceName, new Set<string>());
									}
									interfaceImplementations.get(interfaceName)?.add(structName);
									
									console.log(`${structName} 通过组合 ${fieldType} 间接实现了接口 ${interfaceName}`);
									hasNewImplementation = true;
								}
							}
						}
					}
				}
			}
		}
		
		// 输出最终的接口实现结果
		for (const [interfaceName, implementingStructs] of interfaceImplementations.entries()) {
			console.log(`接口 ${interfaceName} 被以下结构体实现: ${Array.from(implementingStructs).join(', ')}`);
		}
		
		return implementedInterfaces;
	}
}

// 装饰生成类
class DecorationGenerator {
	constructor(private parser: GoCodeParser) {}
	
	// 生成接口装饰 - 修改以支持跨文件
	async generateInterfaceDecorations(currentDocument: vscode.TextDocument, 
									implementedInterfaces: Set<string>,
									interfaceLocationsMap: Map<string, Map<string, { line: number, uri: vscode.Uri }>>): Promise<vscode.DecorationOptions[]> {
		const interfaceDecorations: vscode.DecorationOptions[] = [];
		
		// 只为当前文档生成装饰
		const currentDocUriString = currentDocument.uri.toString();
		
		for (const [interfaceName, methodLocations] of interfaceLocationsMap.entries()) {
			if (implementedInterfaces.has(interfaceName)) {
				// 为接口定义添加装饰
				const interfaceDefLocation = methodLocations.get('__interface_def__');
				if (interfaceDefLocation && interfaceDefLocation.uri.toString() === currentDocUriString) {
					interfaceDecorations.push({
						range: new vscode.Range(
							new vscode.Position(interfaceDefLocation.line, 0),
							new vscode.Position(interfaceDefLocation.line, 0)
						)
					});
				}
				
				// 为接口方法添加装饰
				for (const [methodName, methodLocation] of methodLocations.entries()) {
					// 跳过接口定义特殊标记
					if (methodName === '__interface_def__') {
						continue;
					}
					
					// 只为当前文档中的方法添加装饰
					if (methodLocation.uri.toString() === currentDocUriString) {
						interfaceDecorations.push({
							range: new vscode.Range(
								new vscode.Position(methodLocation.line, 0),
								new vscode.Position(methodLocation.line, 0)
							)
						});
					}
				}
			}
		}
		
		return interfaceDecorations;
	}
	
	// 生成实现装饰 - 修改以支持跨文件
	async generateImplementationDecorations(currentDocument: vscode.TextDocument, 
											implementedInterfaces: Set<string>,
											interfaceMethodsMap: Map<string, string[]>,
											structMethodsMap: Map<string, Map<string, { line: number, uri: vscode.Uri }>>,
											structsMap: Map<string, Map<string, any>>): Promise<[vscode.DecorationOptions[], vscode.DecorationOptions[]]> {
		const implementationDecorations: vscode.DecorationOptions[] = [];
		const interfaceReferenceDecorations: vscode.DecorationOptions[] = [];
		
		// 只为当前文档生成装饰
		const currentDocUriString = currentDocument.uri.toString();
		
		// 创建一个集合，存储所有实现了接口的方法
		const interfaceImplementingMethods = new Set<string>();
		
		// 记录实现了接口的方法
		for (const [interfaceName, interfaceMethods] of interfaceMethodsMap.entries()) {
			if (implementedInterfaces.has(interfaceName)) {
				// 将所有接口方法添加到集合中
				for (const method of interfaceMethods) {
					interfaceImplementingMethods.add(method);
				}
			}
		}
		
		// 为实现方法添加装饰
		for (const [structName, methodsMap] of structMethodsMap.entries()) {
			for (const [methodName, methodLocation] of methodsMap.entries()) {
				// 只为实现接口的方法添加装饰，且仅添加到当前文档中
				if (interfaceImplementingMethods.has(methodName) && methodLocation.uri.toString() === currentDocUriString) {
					implementationDecorations.push({
						range: new vscode.Range(
							new vscode.Position(methodLocation.line, 0),
							new vscode.Position(methodLocation.line, 0)
						)
					});
				}
			}
		}
		
		// 为实现接口的结构体添加装饰
		for (const [structName, structInfo] of structsMap.entries()) {
			// 检查该结构体是否实现了任何接口
			let implementsAnyInterface = false;
			
			// 通过检查是否有与该结构体关联的实现方法来确定
			for (const [method, location] of structMethodsMap.get(structName) || new Map()) {
				if (interfaceImplementingMethods.has(method)) {
					implementsAnyInterface = true;
					break;
				}
			}
			
			// 如果结构体实现了接口，或者是特殊命名的结构体，添加装饰
			if (implementsAnyInterface || 
				structName.toLowerCase().includes('service') || 
				structName.toLowerCase().includes('repository') ||
				structName.toLowerCase().includes('store') ||
				structName.toLowerCase().includes('dao') ||
				structName.toLowerCase().includes('cache') ||
				structName.toLowerCase().includes('manager') ||
				structName.toLowerCase().includes('limiter')) {
				
				const structLine = structInfo.get('line');
				const structUri = structInfo.get('uri');
				
				// 只为当前文档中的结构体添加装饰
				if (structUri && structUri.toString() === currentDocUriString) {
					implementationDecorations.push({
						range: new vscode.Range(
							new vscode.Position(structLine, 0),
							new vscode.Position(structLine, 0)
						)
					});
				}
			}
			
			// 为嵌入字段添加装饰（只有嵌入字段可能对接口实现有影响）
			const fields = structInfo.get('fields');
			for (const [fieldName, fieldInfo] of fields.entries()) {
				// 只为嵌入字段和当前文档中的字段添加装饰
				if (fieldInfo.embedded && fieldInfo.uri.toString() === currentDocUriString) {
					interfaceReferenceDecorations.push({
						range: new vscode.Range(
							new vscode.Position(fieldInfo.line, 0),
							new vscode.Position(fieldInfo.line, 0)
						)
					});
				}
			}
		}
		
		return [implementationDecorations, interfaceReferenceDecorations];
	}
}

// 缓存管理类
class CacheManager {
	private lineToMethodMap = new Map<string, Map<number, string>>();
	private lineTypeMap = new Map<string, Map<number, 'interface' | 'implementation'>>();
	private decoratedLines = new Map<string, Set<number>>();
	
	// 更新方法映射
	updateMethodMap(docKey: string, methodMap: Map<number, string>) {
		this.lineToMethodMap.set(docKey, methodMap);
	}
	
	// 更新行类型映射
	updateLineTypeMap(docKey: string, lineTypes: Map<number, 'interface' | 'implementation'>) {
		this.lineTypeMap.set(docKey, lineTypes);
	}
	
	// 更新装饰行集合
	updateDecoratedLines(docKey: string, decoratedLines: Set<number>) {
		this.decoratedLines.set(docKey, decoratedLines);
	}
	
	// 获取方法映射
	getMethodMap(docKey: string): Map<number, string> | undefined {
		return this.lineToMethodMap.get(docKey);
	}
	
	// 获取行类型映射
	getLineTypeMap(docKey: string): Map<number, 'interface' | 'implementation'> | undefined {
		return this.lineTypeMap.get(docKey);
	}
	
	// 获取装饰行集合
	getDecoratedLines(docKey: string): Set<number> | undefined {
		return this.decoratedLines.get(docKey);
	}
}

// 主扩展管理类
class IJumpExtension {
	private parser: GoCodeParser;
	private decorationManager: DecorationManager;
	private decorationGenerator: DecorationGenerator;
	private cacheManager: CacheManager;
	
	constructor(private context: vscode.ExtensionContext) {
		this.parser = new GoCodeParser();
		this.decorationManager = new DecorationManager(context);
		this.decorationGenerator = new DecorationGenerator(this.parser);
		this.cacheManager = new CacheManager();
		
		this.registerCommands();
		this.registerEventListeners();
	}
	
	// 注册命令
	private registerCommands() {
		// 跳转到接口方法的命令
		this.context.subscriptions.push(
			vscode.commands.registerCommand('ijump.jumpToInterface', async (uri: vscode.Uri, line: number) => {
				await this.jumpToInterface(uri, line);
			})
		);

		// 跳转到实现的命令
		this.context.subscriptions.push(
			vscode.commands.registerCommand('ijump.jumpToImplementation', async (uri: vscode.Uri, line: number) => {
				await this.jumpToImplementation(uri, line);
			})
		);
	}
	
	// 注册事件监听器
	private registerEventListeners() {
		// 监听编辑器变化
		this.context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor) {
					this.updateDecorations(editor);
				}
			})
		);

		// 监听文档变化
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument(event => {
				const editor = vscode.window.activeTextEditor;
				if (editor && event.document === editor.document) {
					this.updateDecorations(editor);
				}
			})
		);
		
		// 添加悬停提示
		this.context.subscriptions.push(
			vscode.languages.registerHoverProvider('go', {
				provideHover: (document, position, token) => this.provideHover(document, position, token)
			})
		);
	}
	
	// 初始化
	initialize() {
		if (vscode.window.activeTextEditor) {
			this.updateDecorations(vscode.window.activeTextEditor);
		}
	}
	
	// 提供悬停信息
	private provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | null {
		const docKey = document.uri.toString();
		const methodMap = this.cacheManager.getMethodMap(docKey);
		const docDecoratedLines = this.cacheManager.getDecoratedLines(docKey);
		const lineTypes = this.cacheManager.getLineTypeMap(docKey);
		
		// 如果行没有被装饰，不显示悬停信息
		if (!methodMap || !methodMap.has(position.line) || 
			!docDecoratedLines || !docDecoratedLines.has(position.line) ||
			!lineTypes || !lineTypes.has(position.line)) {
			return null;
		}
		
		const methodName = methodMap.get(position.line)!;
		const lineType = lineTypes.get(position.line)!;
		const commandUri = `command:ijump.jumpToImplementation?${encodeURIComponent(JSON.stringify([document.uri, position.line]))}`;
		const markdown = new vscode.MarkdownString();
		markdown.isTrusted = true;
		
		if (lineType === 'interface') {
			// 接口或接口方法 - 显示跳转到实现
			markdown.appendMarkdown(`**接口**: ${methodName}\n\n[➡️ 跳转到实现](${commandUri})`);
		} else if (lineType === 'implementation') {
			// 实现方法或结构体 - 显示跳转到接口定义
			markdown.appendMarkdown(`**实现**: ${methodName}\n\n[⬆️ 跳转到接口定义](${commandUri})`);
		} else {
			// 默认情况
			markdown.appendMarkdown(`[➡️ 跳转到 ${methodName} 的实现](${commandUri})`);
		}
		
		return new vscode.Hover(markdown);
	}
	
	// 跳转到接口定义
	private async jumpToInterface(uri: vscode.Uri, line: number) {
		try {
			console.log(`准备跳转到接口: 行 ${line}`);
			const document = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(document);
			
			// 获取方法名
			const docKey = document.uri.toString();
			const methodMap = this.cacheManager.getMethodMap(docKey);
			const methodName = methodMap?.get(line);
			console.log(`实现方法名: ${methodName}`);
			
			if (!methodName) {
				console.error('未找到方法名');
				vscode.window.showErrorMessage('未找到方法名');
				return;
			}
			
			// 使用VS Code内置命令
			await vscode.commands.executeCommand('editor.action.goToTypeDefinition');
		} catch (error) {
			console.error('跳转失败:', error);
			vscode.window.showErrorMessage('无法跳转到接口方法');
		}
	}
	
	// 跳转到实现
	private async jumpToImplementation(uri: vscode.Uri, line: number) {
		try {
			console.log(`准备跳转到实现: 行 ${line}`);
			const document = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(document);
			
			// 获取方法名
			const docKey = document.uri.toString();
			const methodMap = this.cacheManager.getMethodMap(docKey);
			const methodName = methodMap?.get(line);
			console.log(`接口方法名: ${methodName}`);
			
			if (!methodName) {
				console.error('未找到方法名');
				vscode.window.showErrorMessage('未找到方法名');
				return;
			}
			
			// 获取行文本找到方法名的位置
			const lineText = document.lineAt(line).text;
			const methodNameIndex = lineText.indexOf(methodName);
			
			if (methodNameIndex < 0) {
				console.error('在行中未找到方法名');
				vscode.window.showErrorMessage('在行中未找到方法名');
				return;
			}
			
			// 定位光标到方法名上
			const position = new vscode.Position(line, methodNameIndex + Math.floor(methodName.length / 2));
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position));
			
			// 使用VS Code内置命令
			await vscode.commands.executeCommand('editor.action.goToImplementation');
		} catch (error) {
			console.error('跳转失败:', error);
			vscode.window.showErrorMessage('无法跳转到实现');
		}
	}
	
	// 更新装饰
	private async updateDecorations(editor: vscode.TextEditor) {
		if (!editor || editor.document.languageId !== 'go') {
			return;
		}

		const document = editor.document;
		const docKey = document.uri.toString();
		
		// 准备数据结构
		const methodMap = new Map<number, string>();
		const lineTypes = new Map<number, 'interface' | 'implementation'>();
		const docDecoratedLines = new Set<number>();
		
		try {
			// 使用解析器获取信息
			const interfaceNames = await this.parser.getAllInterfaceNames(document);
			const interfaceMethodsMap = await this.parser.parseInterfaces(document);
			const interfaceLocationsMap = await this.parser.parseInterfaceLocations(document);
			const structMethodsMap = await this.parser.parseImplementations(document);
			const structsMap = await this.parser.parseStructs(document, interfaceNames);
			
			// 检查哪些接口被实现了
			const implementedInterfaces = this.parser.checkInterfaceImplementations(
				interfaceMethodsMap, 
				structMethodsMap,
				structsMap
			);
			
			// 生成装饰
			const interfaceDecorations = await this.decorationGenerator.generateInterfaceDecorations(
				document, 
				implementedInterfaces, 
				interfaceLocationsMap
			);
			
			const [implementationDecorations, interfaceReferenceDecorations] = await this.decorationGenerator.generateImplementationDecorations(
				document, 
				implementedInterfaces, 
				interfaceMethodsMap, 
				structMethodsMap, 
				structsMap
			);
			
			// 填充方法映射和行类型信息
			// 接口和接口方法
			for (const [interfaceName, methodLocations] of interfaceLocationsMap.entries()) {
				if (implementedInterfaces.has(interfaceName)) {
					// 接口定义
					const interfaceDefLocation = methodLocations.get('__interface_def__');
					if (interfaceDefLocation && interfaceDefLocation.uri.toString() === docKey) {
						methodMap.set(interfaceDefLocation.line, interfaceName);
						lineTypes.set(interfaceDefLocation.line, 'interface');
						docDecoratedLines.add(interfaceDefLocation.line);
					}
					
					// 接口方法
					for (const [methodName, methodLocation] of methodLocations.entries()) {
						if (methodName !== '__interface_def__' && methodLocation.uri.toString() === docKey) {
							methodMap.set(methodLocation.line, methodName);
							lineTypes.set(methodLocation.line, 'interface');
							docDecoratedLines.add(methodLocation.line);
						}
					}
				}
			}
			
			// 实现方法
			const interfaceImplementingMethods = new Set<string>();
			for (const [interfaceName, methods] of interfaceMethodsMap.entries()) {
				if (implementedInterfaces.has(interfaceName)) {
					for (const method of methods) {
						interfaceImplementingMethods.add(method);
					}
				}
			}
			
			for (const [structName, methodsMap] of structMethodsMap.entries()) {
				for (const [methodName, methodLocation] of methodsMap.entries()) {
					if (interfaceImplementingMethods.has(methodName) && methodLocation.uri.toString() === docKey) {
						methodMap.set(methodLocation.line, methodName);
						lineTypes.set(methodLocation.line, 'implementation');
						docDecoratedLines.add(methodLocation.line);
					}
				}
			}
			
			// 结构体和嵌入字段
			for (const [structName, structInfo] of structsMap.entries()) {
				// 检查该结构体是否实现了任何接口
				let implementsAnyInterface = false;
				
				// 通过检查是否有与该结构体关联的实现方法来确定
				for (const [method, location] of structMethodsMap.get(structName) || new Map()) {
					if (interfaceImplementingMethods.has(method)) {
						implementsAnyInterface = true;
						break;
					}
				}
				
				// 如果结构体实现了接口，或者是特殊命名的结构体，添加装饰
				if (implementsAnyInterface || 
					structName.toLowerCase().includes('service') || 
					structName.toLowerCase().includes('repository') ||
					structName.toLowerCase().includes('store') ||
					structName.toLowerCase().includes('dao') ||
					structName.toLowerCase().includes('cache') ||
					structName.toLowerCase().includes('manager') ||
					structName.toLowerCase().includes('limiter')) {
					
					const structLine = structInfo.get('line');
					const structUri = structInfo.get('uri');
					
					if (structUri && structUri.toString() === docKey) {
						methodMap.set(structLine, structName);
						lineTypes.set(structLine, 'implementation');
						docDecoratedLines.add(structLine);
					}
				}
				
				// 只处理嵌入字段
				const fields = structInfo.get('fields');
				for (const [fieldName, fieldInfo] of fields.entries()) {
					if (fieldInfo.embedded && fieldInfo.uri.toString() === docKey) {
						methodMap.set(fieldInfo.line, fieldInfo.type);
						lineTypes.set(fieldInfo.line, 'interface');
						docDecoratedLines.add(fieldInfo.line);
					}
				}
			}
			
			// 更新缓存
			this.cacheManager.updateMethodMap(docKey, methodMap);
			this.cacheManager.updateLineTypeMap(docKey, lineTypes);
			this.cacheManager.updateDecoratedLines(docKey, docDecoratedLines);
			
			// 应用装饰
			this.decorationManager.applyDecorations(editor, 
				[...interfaceDecorations, ...interfaceReferenceDecorations], 
				implementationDecorations);
		} catch (error) {
			console.error('更新装饰失败:', error);
		}
	}
}

// 激活扩展
export function activate(context: vscode.ExtensionContext) {
	console.log('扩展 "ijump" 已激活!');
	
	// 创建并初始化扩展
	const extension = new IJumpExtension(context);
	extension.initialize();
}

// 停用扩展
export function deactivate() {}

