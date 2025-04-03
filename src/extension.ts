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
					const methodMatch = line.match(/\s*([A-Za-z0-9_]+)\s*\([^)]*\)/);
					if (methodMatch) {
						const methodName = methodMatch[1];
						interfaceMethodsMap.get(interfaceName)?.push(methodName);
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
			const implementationRegex = /func\s+\(\w+\s+\*?(\w+)\)\s+([A-Za-z0-9_]+)\s*\([^)]*\)/g;
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
				structInfo.set('fields', new Map<string, {type: string, line: number, uri: vscode.Uri}>());
				
				const structContent = structMatch[2];
				const contentLines = structContent.split('\n');
				let lineOffset = this.getPositionAt(fileInfo, structMatch.index + structMatch[0].indexOf(structContent)).line;
				
				for (const line of contentLines) {
					// 跳过空行和注释行
					if (!line.trim() || line.trim().startsWith('//')) {
						lineOffset++;
						continue;
					}
					
					// 匹配结构体字段: 字段名 类型
					const fieldMatch = line.match(/\s*(\w+)?\s+([A-Za-z0-9_]+)/);
					if (fieldMatch) {
						const fieldName = fieldMatch[1] || fieldMatch[2];
						const fieldType = fieldMatch[2];
						
						// 只记录引用接口类型的字段
						if (interfaceNames.has(fieldType)) {
							structInfo.get('fields').set(fieldName, {
								type: fieldType,
								line: lineOffset,
								uri: fileInfo.uri
							});
						}
					}
					
					lineOffset++;
				}
				
				structsMap.set(structName, structInfo);
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
								structMethodsMap: Map<string, Map<string, any>>): Set<string> {
		const implementedInterfaces = new Set<string>();
		
		for (const [interfaceName, interfaceMethods] of interfaceMethodsMap.entries()) {
			interfaceLoop: for (const [structName, structMethods] of structMethodsMap.entries()) {
				// 检查结构体是否实现了接口所有方法
				const allMethodsImplemented = interfaceMethods.every(method => 
					structMethods.has(method)
				);
				
				if (allMethodsImplemented && interfaceMethods.length > 0) {
					implementedInterfaces.add(interfaceName);
					console.log(`接口 ${interfaceName} 被 ${structName} 实现`);
					break interfaceLoop;
				}
			}
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
											structsMap: Map<string, Map<string, any>>): Promise<vscode.DecorationOptions[]> {
		const implementationDecorations: vscode.DecorationOptions[] = [];
		
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
		
		// 为服务相关结构体添加装饰
		for (const [structName, structInfo] of structsMap.entries()) {
			if (structName.toLowerCase().includes('service') || 
				structName.toLowerCase().includes('repository') ||
				structName.toLowerCase().includes('store') ||
				structName.toLowerCase().includes('dao')) {
				
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
			
			// 为引用接口类型的字段添加装饰
			const fields = structInfo.get('fields');
			for (const [fieldName, fieldInfo] of fields.entries()) {
				const fieldLine = fieldInfo.line;
				const fieldUri = fieldInfo.uri;
				
				// 只为当前文档中的字段添加装饰
				if (fieldUri && fieldUri.toString() === currentDocUriString) {
					implementationDecorations.push({
						range: new vscode.Range(
							new vscode.Position(fieldLine, 0),
							new vscode.Position(fieldLine, 0)
						)
					});
				}
			}
		}
		
		return implementationDecorations;
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
				structMethodsMap
			);
			
			// 生成装饰
			const interfaceDecorations = await this.decorationGenerator.generateInterfaceDecorations(
				document, 
				implementedInterfaces, 
				interfaceLocationsMap
			);
			
			const implementationDecorations = await this.decorationGenerator.generateImplementationDecorations(
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
			
			// 服务相关结构体和接口引用字段
			for (const [structName, structInfo] of structsMap.entries()) {
				if (structName.toLowerCase().includes('service') || 
					structName.toLowerCase().includes('repository') ||
					structName.toLowerCase().includes('store') ||
					structName.toLowerCase().includes('dao')) {
					
					const structLine = structInfo.get('line');
					const structUri = structInfo.get('uri');
					
					if (structUri && structUri.toString() === docKey) {
						methodMap.set(structLine, structName);
						lineTypes.set(structLine, 'implementation');
						docDecoratedLines.add(structLine);
					}
				}
				
				// 接口引用字段
				const fields = structInfo.get('fields');
				for (const [fieldName, fieldInfo] of fields.entries()) {
					const fieldType = fieldInfo.type;
					const fieldLine = fieldInfo.line;
					const fieldUri = fieldInfo.uri;
					
					if (fieldUri && fieldUri.toString() === docKey) {
						methodMap.set(fieldLine, fieldType);
						lineTypes.set(fieldLine, 'implementation');
						docDecoratedLines.add(fieldLine);
					}
				}
			}
			
			// 更新缓存
			this.cacheManager.updateMethodMap(docKey, methodMap);
			this.cacheManager.updateLineTypeMap(docKey, lineTypes);
			this.cacheManager.updateDecoratedLines(docKey, docDecoratedLines);
			
			// 应用装饰
			this.decorationManager.applyDecorations(editor, interfaceDecorations, implementationDecorations);
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

