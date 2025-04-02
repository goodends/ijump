// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('扩展 "ijump" 已激活!');

	// 创建装饰类型
	const interfaceIconPath = path.join(context.extensionPath, 'resources', 'interface.svg');
	const implementationIconPath = path.join(context.extensionPath, 'resources', 'implementation.svg');
	console.log('接口图标路径:', interfaceIconPath);
	console.log('实现图标路径:', implementationIconPath);
	
	// 接口方法装饰（跳转到实现）- 使用绿色图标
	const interfaceDecorationType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: interfaceIconPath,
		gutterIconSize: '60%',
		isWholeLine: false
	});
	
	// 实现方法装饰（跳转到接口）- 使用蓝色图标
	const implementationDecorationType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: implementationIconPath,
		gutterIconSize: '60%',
		isWholeLine: false
	});

	// 缓存映射
	const lineToMethodMap = new Map<string, Map<number, string>>();
	// 存储实现方法与接口方法的映射关系
	const implToInterfaceMap = new Map<string, Map<string, string>>();
	// 存储已装饰的行号
	const decoratedLines = new Map<string, Set<number>>();

	// 跳转到接口方法的命令
	context.subscriptions.push(
		vscode.commands.registerCommand('ijump.jumpToInterface', async (uri: vscode.Uri, line: number) => {
			try {
				console.log(`准备跳转到接口: 行 ${line}`);
				// 打开文档并定位到指定行
				const document = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(document);
				
				// 获取方法名和行文本
				const docKey = document.uri.toString();
				const methodMap = lineToMethodMap.get(docKey);
				const methodName = methodMap?.get(line);
				console.log(`实现方法名: ${methodName}`);
				
				if (!methodName) {
					console.error('未找到方法名');
					vscode.window.showErrorMessage('未找到方法名');
					return;
				}
				
				// 查找实现方法对应的接口定义
				// 使用vscode.executeDefinitionProvider查找接口定义
				const position = new vscode.Position(line, document.lineAt(line).text.indexOf(methodName) + Math.floor(methodName.length / 2));
				
				// 使用符号搜索接口方法
				await vscode.commands.executeCommand('editor.action.goToTypeDefinition');
			} catch (error) {
				console.error('跳转失败:', error);
				vscode.window.showErrorMessage('无法跳转到接口方法');
			}
		})
	);

	// 跳转到实现的命令
	context.subscriptions.push(
		vscode.commands.registerCommand('ijump.jumpToImplementation', async (uri: vscode.Uri, line: number) => {
			try {
				console.log(`准备跳转到实现: 行 ${line}`);
				// 打开文档并定位到指定行
				const document = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(document);
				
				// 获取方法名和行文本
				const docKey = document.uri.toString();
				const methodMap = lineToMethodMap.get(docKey);
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
				
				// 定位光标到方法名上，而不是行开始
				const position = new vscode.Position(line, methodNameIndex + Math.floor(methodName.length / 2));
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position));
				
				// 直接使用VS Code内置的跳转命令
				await vscode.commands.executeCommand('editor.action.goToImplementation');
			} catch (error) {
				console.error('跳转失败:', error);
				vscode.window.showErrorMessage('无法跳转到实现');
			}
		})
	);

	// 扫描Go文件，更新装饰和方法映射
	function updateDecorations(editor: vscode.TextEditor) {
		if (!editor || editor.document.languageId !== 'go') {
			return;
		}

		const document = editor.document;
		const interfaceDecorations: vscode.DecorationOptions[] = [];
		const implementationDecorations: vscode.DecorationOptions[] = [];
		const methodMap = new Map<number, string>();
		
		// 创建文档的装饰行集合
		const docDecoratedLines = new Set<number>();

		// 存储接口名称及其方法
		const interfaceMethodsMap = new Map<string, string[]>();
		// 存储结构体名称及其方法
		const structMethodsMap = new Map<string, string[]>();
		// 存储已实现的接口名称
		const implementedInterfaces = new Set<string>();
		// 临时存储接口和方法的行信息，等确认是否实现后再添加装饰
		const interfaceLines = new Map<string, number>(); // 接口名称 -> 行号
		const interfaceMethodLines = new Map<string, Map<string, number>>(); // 接口名称 -> 方法名称 -> 行号

		// 1. 使用正则匹配接口定义和方法
		const text = document.getText();
		const interfaceRegex = /type\s+(\w+)\s+interface\s*\{([^}]*)\}/gs;
		let interfaceMatch;
		
		console.log('开始扫描接口...');
		while ((interfaceMatch = interfaceRegex.exec(text)) !== null) {
			// 处理接口定义行
			const interfaceName = interfaceMatch[1];
			const interfaceStartPos = document.positionAt(interfaceMatch.index);
			const interfaceLine = interfaceStartPos.line;
			
			// 为接口定义行记录信息
			methodMap.set(interfaceLine, interfaceName);
			console.log(`找到接口: ${interfaceName} at line ${interfaceLine}`);
			
			// 记录接口行号
			interfaceLines.set(interfaceName, interfaceLine);
			
			// 初始化接口方法列表和方法行号映射
			if (!interfaceMethodsMap.has(interfaceName)) {
				interfaceMethodsMap.set(interfaceName, []);
				interfaceMethodLines.set(interfaceName, new Map<string, number>());
			}

			const interfaceContent = interfaceMatch[2];
			
			// 按行分割接口内容以更精确地处理每行
			const contentLines = interfaceContent.split('\n');
			let lineOffset = document.positionAt(interfaceMatch.index + interfaceMatch[0].indexOf(interfaceContent)).line;
			
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
					
					// 记录方法行号和名称的对应关系
					methodMap.set(lineOffset, methodName);
					console.log(`找到接口方法: ${methodName} at line ${lineOffset}`);
					
					// 记录接口方法和行号
					interfaceMethodsMap.get(interfaceName)?.push(methodName);
					interfaceMethodLines.get(interfaceName)?.set(methodName, lineOffset);
				}
				
				lineOffset++;
			}
		}
		
		// 2. 扫描方法实现
		const implementationRegex = /func\s+\(\w+\s+\*?(\w+)\)\s+([A-Za-z0-9_]+)\s*\([^)]*\)/g;
		let implMatch;
		
		console.log('开始扫描实现方法...');
		while ((implMatch = implementationRegex.exec(text)) !== null) {
			const receiverType = implMatch[1];
			const methodName = implMatch[2];
			const methodPos = document.positionAt(implMatch.index);
			const methodLine = methodPos.line;
			
			// 记录方法行号和名称的对应关系
			methodMap.set(methodLine, methodName);
			console.log(`找到实现方法: ${receiverType}.${methodName} at line ${methodLine}`);
			
			// 记录结构体方法
			if (!structMethodsMap.has(receiverType)) {
				structMethodsMap.set(receiverType, []);
			}
			structMethodsMap.get(receiverType)?.push(methodName);
		}
		
		// 3. 检查结构体是否实现了接口
		for (const [interfaceName, interfaceMethods] of interfaceMethodsMap.entries()) {
			interfaceLoop: for (const [structName, structMethods] of structMethodsMap.entries()) {
				// 检查结构体是否实现了接口所有方法
				const allMethodsImplemented = interfaceMethods.every(method => 
					structMethods.includes(method)
				);
				
				if (allMethodsImplemented && interfaceMethods.length > 0) {
					implementedInterfaces.add(interfaceName);
					console.log(`接口 ${interfaceName} 被 ${structName} 实现`);
					break interfaceLoop;
				}
			}
		}
		
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
		
		// 4. 为已实现的接口添加装饰
		for (const [interfaceName, line] of interfaceLines.entries()) {
			if (implementedInterfaces.has(interfaceName)) {
				// 为接口定义添加装饰
				const interfaceDefMarkdown = new vscode.MarkdownString();
				interfaceDefMarkdown.isTrusted = true;
				interfaceDefMarkdown.appendMarkdown(`**接口定义**: ${interfaceName}\n\n[➡️ 跳转到实现](command:editor.action.goToImplementation)`);
				
				interfaceDecorations.push({
					range: new vscode.Range(
						new vscode.Position(line, 0),
						new vscode.Position(line, 0)
					),
					hoverMessage: interfaceDefMarkdown
				});
				
				// 记录装饰的行
				docDecoratedLines.add(line);
				
				// 为接口方法添加装饰
				const methodLines = interfaceMethodLines.get(interfaceName);
				if (methodLines) {
					for (const [methodName, methodLine] of methodLines.entries()) {
						const markdown = new vscode.MarkdownString();
						markdown.isTrusted = true;
						markdown.appendMarkdown(`**接口方法**: ${methodName}\n\n[➡️ 跳转到实现](command:editor.action.goToImplementation)`);
						
						interfaceDecorations.push({
							range: new vscode.Range(
								new vscode.Position(methodLine, 0),
								new vscode.Position(methodLine, 0)
							),
							hoverMessage: markdown
						});
						
						// 记录装饰的行
						docDecoratedLines.add(methodLine);
					}
				}
			}
		}
		
		// 5. 为实现接口的方法添加装饰
		// 清空之前的实现装饰
		implementationDecorations.length = 0;
		
		// 重新扫描方法实现，只为实现接口的方法添加装饰
		const implementationRegexForDecoration = /func\s+\(\w+\s+\*?(\w+)\)\s+([A-Za-z0-9_]+)\s*\([^)]*\)/g;
		while ((implMatch = implementationRegexForDecoration.exec(text)) !== null) {
			const receiverType = implMatch[1];
			const methodName = implMatch[2];
			const methodPos = document.positionAt(implMatch.index);
			const methodLine = methodPos.line;
			
			// 只为实现接口的方法添加装饰
			if (interfaceImplementingMethods.has(methodName)) {
				// 添加装饰 - 只在装订线区域显示图标
				const range = new vscode.Range(
					new vscode.Position(methodLine, 0),
					new vscode.Position(methodLine, 0)
				);
				
				const markdown = new vscode.MarkdownString();
				markdown.isTrusted = true;
				markdown.appendMarkdown(`**实现方法**: ${methodName}\n\n[⬆️ 跳转到接口定义](command:editor.action.goToTypeDefinition)`);
				
				implementationDecorations.push({
					range,
					hoverMessage: markdown
				});
				
				// 记录装饰的行
				docDecoratedLines.add(methodLine);
			}
		}
		
		// 1.5 使用正则匹配结构体定义和字段
		const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/gs;
		let structMatch;
		
		// 存储接口名字以便检查结构体字段是否引用了接口
		const interfaceNames = new Set<string>();
		
		// 收集所有接口名称
		const allInterfaceRegex = /type\s+(\w+)\s+interface\s*\{/g;
		let interfaceNameMatch;
		while ((interfaceNameMatch = allInterfaceRegex.exec(text)) !== null) {
			interfaceNames.add(interfaceNameMatch[1]);
		}
		
		console.log('开始扫描结构体...');
		while ((structMatch = structRegex.exec(text)) !== null) {
			const structName = structMatch[1];
			const structStartPos = document.positionAt(structMatch.index);
			const structLine = structStartPos.line;
			
			// 为结构体定义行添加装饰（只针对service或repository相关结构体）
			if (structName.toLowerCase().includes('service') || 
				structName.toLowerCase().includes('repository') ||
				structName.toLowerCase().includes('store') ||
				structName.toLowerCase().includes('dao')) {
				
				methodMap.set(structLine, structName);
				console.log(`找到服务相关结构体: ${structName} at line ${structLine}`);
				
				const structMarkdown = new vscode.MarkdownString();
				structMarkdown.isTrusted = true;
				structMarkdown.appendMarkdown(`**服务结构体**: ${structName}\n\n[🔍 查找引用](command:editor.action.goToReferences)`);
				
				implementationDecorations.push({
					range: new vscode.Range(
						new vscode.Position(structLine, 0),
						new vscode.Position(structLine, 0)
					),
					hoverMessage: structMarkdown
				});
				
				// 记录装饰的行
				docDecoratedLines.add(structLine);
			}

			const structContent = structMatch[2];
			
			// 按行分割结构体内容以更精确地处理每行
			const contentLines = structContent.split('\n');
			let lineOffset = document.positionAt(structMatch.index + structMatch[0].indexOf(structContent)).line;
			
			for (const line of contentLines) {
				// 跳过空行和注释行
				if (!line.trim() || line.trim().startsWith('//')) {
					lineOffset++;
					continue;
				}
				
				// 匹配结构体字段: 字段名 类型
				const fieldMatch = line.match(/\s*(\w+)?\s+([A-Za-z0-9_]+)/);
				if (fieldMatch) {
					const fieldName = fieldMatch[1] || fieldMatch[2]; // 如果第一个捕获组为空，则使用第二个（可能是嵌入式字段）
					const fieldType = fieldMatch[2];
					
					// 只为引用接口类型的字段添加跳转功能
					if (interfaceNames.has(fieldType)) {
						// 记录字段行号和名称的对应关系
						methodMap.set(lineOffset, fieldType);
						console.log(`找到接口引用字段: ${fieldName}: ${fieldType} at line ${lineOffset}`);
						
						// 添加装饰 - 只在装订线区域显示图标
						const range = new vscode.Range(
							new vscode.Position(lineOffset, 0),
							new vscode.Position(lineOffset, 0)
						);
						
						const fieldMarkdown = new vscode.MarkdownString();
						fieldMarkdown.isTrusted = true;
						fieldMarkdown.appendMarkdown(`**接口引用**: ${fieldType}\n\n[⬆️ 跳转到接口定义](command:editor.action.goToTypeDefinition)`);
						
						implementationDecorations.push({
							range,
							hoverMessage: fieldMarkdown
						});
						
						// 记录装饰的行
						docDecoratedLines.add(lineOffset);
					}
				}
				
				lineOffset++;
			}
		}
		
		// 保存方法映射
		const docKey = document.uri.toString();
		lineToMethodMap.set(docKey, methodMap);
		
		// 保存装饰行信息
		decoratedLines.set(docKey, docDecoratedLines);
		
		// 应用装饰
		editor.setDecorations(interfaceDecorationType, interfaceDecorations);
		editor.setDecorations(implementationDecorationType, implementationDecorations);
		console.log(`应用了 ${interfaceDecorations.length} 个接口装饰和 ${implementationDecorations.length} 个实现装饰`);
	}

	// 添加文档悬停提示
	context.subscriptions.push(
		vscode.languages.registerHoverProvider('go', {
			provideHover(document, position, token) {
				const docKey = document.uri.toString();
				const methodMap = lineToMethodMap.get(docKey);
				const docDecoratedLines = decoratedLines.get(docKey);
				
				// 如果行没有被装饰，不显示悬停信息
				if (!methodMap || !methodMap.has(position.line) || !docDecoratedLines || !docDecoratedLines.has(position.line)) {
					return null;
				}
				
				const methodName = methodMap.get(position.line)!;
				const commandUri = `command:ijump.jumpToImplementation?${encodeURIComponent(JSON.stringify([document.uri, position.line]))}`;
				const markdown = new vscode.MarkdownString();
				markdown.isTrusted = true;
				markdown.appendMarkdown(`[➡️ 跳转到 ${methodName} 的实现](${commandUri})`);
				return new vscode.Hover(markdown);
			}
		})
	);

	// 监听编辑器变化
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				updateDecorations(editor);
			}
		})
	);

	// 监听文档变化
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;
			if (editor && event.document === editor.document) {
				updateDecorations(editor);
			}
		})
	);

	// 初始化
	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
