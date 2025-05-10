// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { GoAstParser } from './goAstParser';
import * as fs from 'fs';

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

// 装饰生成类
class DecorationGenerator {
	constructor(private parser: GoAstParser) {}
	
	// 生成接口装饰 - 使用AST解析器
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
	
	// 生成实现装饰 - 使用AST解析器
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
				if (method !== '__struct_def__' && interfaceImplementingMethods.has(method)) {
					implementsAnyInterface = true;
					break;
				}
			}
			
			// 检查是否有显式声明的接口实现关系
			if (structInfo.has('implementsInterfaces') && structInfo.get('implementsInterfaces').size > 0) {
				implementsAnyInterface = true;
			}
			
			// 只为真正实现了接口的结构体添加装饰，不再基于名称匹配
			if (implementsAnyInterface) {
				const structLine = structInfo.get('line');
				const structUri = structInfo.get('uri');
				
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
	private parser: GoAstParser;
	private decorationManager: DecorationManager;
	private decorationGenerator: DecorationGenerator;
	private cacheManager: CacheManager;
	private updateThrottleTimer: NodeJS.Timeout | null = null;
	private throttleDelay: number = 100; // 减少到100毫秒节流延迟
	private lastAnalyzedFile: string = ''; // 记录上次解析的文件路径
	
	constructor(private context: vscode.ExtensionContext) {
		this.parser = new GoAstParser(context.extensionPath);
		this.decorationManager = new DecorationManager(context);
		this.decorationGenerator = new DecorationGenerator(this.parser);
		this.cacheManager = new CacheManager();
		
		this.registerCommands();
		this.registerEventListeners();
		this.registerFileWatcher();
	}
	
	/**
	 * 检查预编译解析器是否存在
	 */
	private async checkParser(): Promise<boolean> {
		const parserPath = path.join(this.context.extensionPath, 'src', 'parser', 'parser');
		const exists = fs.existsSync(parserPath);
		
		if (!exists) {
			const message = '未找到预编译的Go解析器，接口跳转功能将不可用';
			const detail = '这可能是因为插件在打包时未能正确包含预编译的Go解析器。如果您是通过本地开发安装的插件，请尝试使用发布版本。';
			
			console.error(`[IJump] ${message}`);
			
			const goVersion = await this.checkGoEnvironment();
			if (goVersion) {
				const compile = '尝试编译';
				const result = await vscode.window.showErrorMessage(
					`[IJump] ${message}`, 
					{ modal: false, detail },
					compile
				);
				
				if (result === compile) {
					const success = await this.parser.ensureParserReady();
					if (success) {
						vscode.window.showInformationMessage('[IJump] Go解析器编译成功');
						return true;
					} else {
						vscode.window.showErrorMessage('[IJump] Go解析器编译失败，接口跳转功能将不可用');
					}
				}
			} else {
				const installGo = '了解如何安装Go';
				const result = await vscode.window.showErrorMessage(
					`[IJump] ${message}。未检测到Go环境，接口跳转功能将不可用。`, 
					{ modal: false, detail: detail + '\n\n要编译解析器，请安装Go编程语言。' },
					installGo
				);
				
				if (result === installGo) {
					vscode.env.openExternal(vscode.Uri.parse('https://golang.org/doc/install'));
				}
			}
			
			console.log('[IJump] 将以降级模式运行，部分功能可能不可用');
			return false;
		}
		
		return true;
	}
	
	/**
	 * 检查Go环境
	 */
	private async checkGoEnvironment(): Promise<string | null> {
		try {
			const { promisify } = require('util');
			const execFile = promisify(require('child_process').execFile);
			const { stdout } = await execFile('go', ['version']);
			return stdout.trim();
		} catch (e) {
			return null;
		}
	}

	initialize() {
		// 检查解析器
		this.checkParser().then(exists => {
			if (exists) {
				console.log('[IJump] 预编译的Go解析器已就绪');
				
				// 处理当前打开的编辑器
				if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'go') {
					// 立即更新，不使用节流
					this.updateDecorations(vscode.window.activeTextEditor);
					this.lastAnalyzedFile = vscode.window.activeTextEditor.document.uri.fsPath;
				}
			}
		});
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
	
	// 更新装饰的节流函数
	private throttleUpdateDecorations(editor: vscode.TextEditor) {
		// 取消先前的更新计时器
		if (this.updateThrottleTimer) {
			clearTimeout(this.updateThrottleTimer);
		}
		
		// 设置新的延迟更新，采用更短的延迟时间
		this.updateThrottleTimer = setTimeout(() => {
			this.updateDecorations(editor);
			this.updateThrottleTimer = null;
		}, this.throttleDelay);
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
			// 使用AST解析器获取信息
			const parseResult = await this.parser.parseGoFile(document.uri.fsPath);
			
			// 检查是否返回了有效的包信息
			if (!parseResult || !parseResult.packages || Object.keys(parseResult.packages).length === 0) {
				console.log('未找到有效的Go包信息，跳过装饰更新');
				return;
			}
			
			// 获取接口和实现信息
			const interfaceNames = this.parser.getAllInterfaceNames(parseResult);
			const interfaceMethodsMap = this.parser.getInterfaceMethods(parseResult);
			const interfaceLocationsMap = this.parser.getInterfaceLocations(parseResult);
			const structMethodsMap = this.parser.getImplementations(parseResult);
			const structsMap = this.parser.getStructsInfo(parseResult, interfaceNames);
			
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
					if (method !== '__struct_def__' && interfaceImplementingMethods.has(method)) {
						implementsAnyInterface = true;
						break;
					}
				}
				
				// 检查是否有显式声明的接口实现关系
				if (structInfo.has('implementsInterfaces') && structInfo.get('implementsInterfaces').size > 0) {
					implementsAnyInterface = true;
				}
				
				// 只为真正实现了接口的结构体添加装饰，不再基于名称匹配
				if (implementsAnyInterface) {
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
				if (fields) {
					for (const [fieldName, fieldInfo] of fields.entries()) {
						if (fieldInfo.embedded && fieldInfo.uri.toString() === docKey) {
							methodMap.set(fieldInfo.line, fieldInfo.type);
							lineTypes.set(fieldInfo.line, 'interface');
							docDecoratedLines.add(fieldInfo.line);
						}
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
		
		// 添加清除缓存命令
		this.context.subscriptions.push(
			vscode.commands.registerCommand('ijump.clearCache', () => {
				this.parser.clearCache();
				vscode.window.showInformationMessage('IJump: 已清除所有缓存');
				
				// 如果当前有活动编辑器，更新装饰
				if (vscode.window.activeTextEditor) {
					this.throttleUpdateDecorations(vscode.window.activeTextEditor);
				}
			})
		);
	}
	
	// 注册事件监听器
	private registerEventListeners() {
		// 监听编辑器变化
		this.context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor && editor.document.languageId === 'go') {
					// 只在切换到不同文件时触发更新
					if (this.lastAnalyzedFile !== editor.document.uri.fsPath) {
						// 立即更新，不使用节流
						this.updateDecorations(editor);
						this.lastAnalyzedFile = editor.document.uri.fsPath;
					}
				}
			})
		);

		// 监听文档保存 - 只在保存Go文件时更新，而不是每次编辑
		this.context.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(document => {
				const editor = vscode.window.activeTextEditor;
				if (editor && document.languageId === 'go' && document === editor.document) {
					// 清除保存文件所在包的缓存
					this.parser.clearCache(document.uri.fsPath);
					// 立即更新，不使用节流
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
	
	// 监视Go文件变化
	private registerFileWatcher() {
		// 创建Go文件变更监视器
		const goFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.go');
		
		// 监听文件创建
		this.context.subscriptions.push(
			goFileWatcher.onDidCreate(uri => {
				// 新文件创建时清除所在包的缓存
				this.parser.clearCache(uri.fsPath);
				
				// 检查是否需要更新当前编辑器装饰
				const editor = vscode.window.activeTextEditor;
				if (editor && path.dirname(editor.document.uri.fsPath) === path.dirname(uri.fsPath)) {
					this.throttleUpdateDecorations(editor);
				}
			})
		);
		
		// 监听文件删除
		this.context.subscriptions.push(
			goFileWatcher.onDidDelete(uri => {
				// 文件删除时清除所在包的缓存
				this.parser.clearCache(uri.fsPath);
				
				// 检查是否需要更新当前编辑器装饰
				const editor = vscode.window.activeTextEditor;
				if (editor && path.dirname(editor.document.uri.fsPath) === path.dirname(uri.fsPath)) {
					this.throttleUpdateDecorations(editor);
				}
			})
		);
		
		// 添加到订阅列表
		this.context.subscriptions.push(goFileWatcher);
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

