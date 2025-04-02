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
	const interfaceIconPath = path.join(context.extensionPath, 'resources', 'implementation.svg');
	const implementationIconPath = path.join(context.extensionPath, 'resources', 'implementation.svg'); // 可以使用相同图标或创建新图标
	console.log('接口图标路径:', interfaceIconPath);
	
	// 接口方法装饰（跳转到实现）
	const interfaceDecorationType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: interfaceIconPath,
		gutterIconSize: '60%',
		isWholeLine: false
	});
	
	// 实现方法装饰（跳转到接口）
	const implementationDecorationType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: implementationIconPath,
		gutterIconSize: '60%',
		isWholeLine: false
	});

	// 缓存映射
	const lineToMethodMap = new Map<string, Map<number, string>>();
	// 存储实现方法与接口方法的映射关系
	const implToInterfaceMap = new Map<string, Map<string, string>>();

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
			
			// 为接口定义行添加装饰
			methodMap.set(interfaceLine, interfaceName);
			console.log(`找到接口: ${interfaceName} at line ${interfaceLine}`);
			
			interfaceDecorations.push({
				range: new vscode.Range(
					new vscode.Position(interfaceLine, 0),
					new vscode.Position(interfaceLine, 0)
				),
				hoverMessage: `点击跳转到 ${interfaceName} 的实现`
			});

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
					
					// 添加装饰 - 只在装订线区域显示图标
					const range = new vscode.Range(
						new vscode.Position(lineOffset, 0),
						new vscode.Position(lineOffset, 0)
					);
					
					interfaceDecorations.push({
						range,
						hoverMessage: `点击跳转到 ${methodName} 的实现`
					});
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
			
			// 添加装饰 - 只在装订线区域显示图标
			const range = new vscode.Range(
				new vscode.Position(methodLine, 0),
				new vscode.Position(methodLine, 0)
			);
			
			implementationDecorations.push({
				range,
				hoverMessage: `点击跳转到 ${methodName} 的接口定义`
			});
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
				
				interfaceDecorations.push({
					range: new vscode.Range(
						new vscode.Position(structLine, 0),
						new vscode.Position(structLine, 0)
					),
					hoverMessage: `点击跳转到 ${structName} 的引用或实现`
				});
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
						
						interfaceDecorations.push({
							range,
							hoverMessage: `点击跳转到 ${fieldType} 的定义`
						});
					}
				}
				
				lineOffset++;
			}
		}
		
		// 保存方法映射
		const docKey = document.uri.toString();
		lineToMethodMap.set(docKey, methodMap);
		
		// 应用装饰
		editor.setDecorations(interfaceDecorationType, interfaceDecorations);
		editor.setDecorations(implementationDecorationType, implementationDecorations);
		console.log(`应用了 ${interfaceDecorations.length} 个接口装饰和 ${implementationDecorations.length} 个实现装饰`);
	}

	// 处理图标点击事件
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(event => {
			const editor = event.textEditor;
			if (editor && editor.document.languageId === 'go' && 
				event.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
				
				const clickedLine = editor.selection.active.line;
				const clickedChar = editor.selection.active.character;
				
				console.log(`点击事件: line=${clickedLine}, char=${clickedChar}`);
				
				// 只响应在最左侧区域的点击（装订线区域）
				if (clickedChar > 3) {
					return; // 不是点击图标区域，忽略
				}
				
				// 检查是否在方法名前面的图标区域点击
				const docKey = editor.document.uri.toString();
				const methodMap = lineToMethodMap.get(docKey);
				
				if (methodMap && methodMap.has(clickedLine)) {
					const methodName = methodMap.get(clickedLine)!;
					const lineText = editor.document.lineAt(clickedLine).text;
					
					// 检查是接口方法、结构体字段还是实现方法
					if (lineText.trim().startsWith('func (')) {
						// 实现方法 - 跳转到接口
						console.log('点击了实现方法图标');
						vscode.commands.executeCommand(
							'ijump.jumpToInterface', 
							editor.document.uri, 
							clickedLine
						);
					} else if (lineText.trim().startsWith('type') && lineText.includes('struct')) {
						// 结构体定义 - 查找引用
						console.log('点击了结构体定义图标');
						vscode.commands.executeCommand(
							'editor.action.findReferences', 
							editor.document.uri, 
							new vscode.Position(clickedLine, lineText.indexOf(methodName))
						);
					} else if (lineText.includes('struct')) {
						// 结构体字段 - 跳转到字段类型定义
						console.log('点击了结构体字段图标');
						// 定位到字段类型名称
						const position = new vscode.Position(
							clickedLine, 
							lineText.indexOf(methodName)
						);
						editor.selection = new vscode.Selection(position, position);
						editor.revealRange(new vscode.Range(position, position));
						
						vscode.commands.executeCommand('editor.action.goToDefinition');
					} else {
						// 接口方法或接口定义 - 跳转到实现
						console.log('点击了接口方法/接口定义图标');
						vscode.commands.executeCommand(
							'ijump.jumpToImplementation', 
							editor.document.uri, 
							clickedLine
						);
					}
				}
			}
		})
	);

	// 添加专门用于行号旁图标的点击处理
	context.subscriptions.push(
		vscode.commands.registerCommand('ijump.clickGutterIcon', (uri: vscode.Uri, line: number) => {
			console.log(`点击了图标: ${uri.toString()} 行 ${line}`);
			vscode.commands.executeCommand('ijump.jumpToImplementation', uri, line);
		})
	);

	// 添加文档悬停提示
	context.subscriptions.push(
		vscode.languages.registerHoverProvider('go', {
			provideHover(document, position, token) {
				const docKey = document.uri.toString();
				const methodMap = lineToMethodMap.get(docKey);
				
				if (methodMap && methodMap.has(position.line)) {
					const methodName = methodMap.get(position.line)!;
					const commandUri = `command:ijump.jumpToImplementation?${encodeURIComponent(JSON.stringify([document.uri, position.line]))}`;
					const markdown = new vscode.MarkdownString();
					markdown.isTrusted = true;
					markdown.appendMarkdown(`[➡️ 跳转到 ${methodName} 的实现](${commandUri})`);
					return new vscode.Hover(markdown);
				}
				
				return null;
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
