package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
)

// 接口方法信息
type MethodInfo struct {
	Name     string `json:"name"`
	Line     int    `json:"line"`
	FilePath string `json:"filePath"`
}

// 接口定义信息
type InterfaceInfo struct {
	Name         string       `json:"name"`
	Line         int          `json:"line"`
	FilePath     string       `json:"filePath"`
	Methods      []MethodInfo `json:"methods"`
	InternalType string       `json:"internalType,omitempty"` // 可能的内嵌接口名
}

// 结构体字段信息
type FieldInfo struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Line      int    `json:"line"`
	FilePath  string `json:"filePath"`
	Embedded  bool   `json:"embedded"`
	IsPointer bool   `json:"isPointer"`
}

// 结构体定义信息
type StructInfo struct {
	Name     string      `json:"name"`
	Line     int         `json:"line"`
	FilePath string      `json:"filePath"`
	Fields   []FieldInfo `json:"fields"`
}

// 方法实现信息
type ImplementationInfo struct {
	ReceiverType string `json:"receiverType"`
	MethodName   string `json:"methodName"`
	Line         int    `json:"line"`
	FilePath     string `json:"filePath"`
	IsPointer    bool   `json:"isPointer"`
}

// 包信息
type PackageInfo struct {
	Path       string               `json:"path"`
	Name       string               `json:"name"`
	Interfaces []InterfaceInfo      `json:"interfaces"`
	Structs    []StructInfo         `json:"structs"`
	Methods    []ImplementationInfo `json:"methods"`
}

// 解析结果
type ParseResult struct {
	Packages map[string]PackageInfo `json:"packages"`
}

// 从文件位置获取行号
func getLineFromPos(fset *token.FileSet, pos token.Pos) int {
	// 返回行号减1，使装饰显示在方法定义行
	return fset.Position(pos).Line - 1
}

// 从类型表达式中提取类型名
func getTypeNameFromExpr(expr ast.Expr) (name string, isPointer bool) {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name, false
	case *ast.StarExpr:
		if ident, ok := t.X.(*ast.Ident); ok {
			return ident.Name, true
		}
	case *ast.SelectorExpr:
		if ident, ok := t.X.(*ast.Ident); ok {
			return ident.Name + "." + t.Sel.Name, false
		}
	}
	return "", false
}

// 递归解析目录下的Go文件
func parseDirectory(dirPath string) (ParseResult, error) {
	result := ParseResult{
		Packages: make(map[string]PackageInfo),
	}

	// 创建一个已处理目录的集合，避免重复处理
	processedDirs := make(map[string]bool)

	// 递归处理同一个包中的所有Go文件
	processDir := func(dir string) error {
		// 避免重复处理同一目录
		if processedDirs[dir] {
			return nil
		}
		processedDirs[dir] = true

		// 查找同包下的所有Go文件
		goFiles, err := filepath.Glob(filepath.Join(dir, "*.go"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "查找Go文件失败 %s: %v\n", dir, err)
			return nil // 继续处理其他目录
		}

		// 解析当前目录中的所有Go文件
		for _, path := range goFiles {
			fset := token.NewFileSet()
			node, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
			if err != nil {
				fmt.Fprintf(os.Stderr, "解析文件失败 %s: %v\n", path, err)
				continue // 继续处理其他文件
			}

			packageName := node.Name.Name
			packagePath := filepath.Dir(path)

			// 确保包信息存在
			if _, exists := result.Packages[packagePath]; !exists {
				result.Packages[packagePath] = PackageInfo{
					Path:       packagePath,
					Name:       packageName,
					Interfaces: []InterfaceInfo{},
					Structs:    []StructInfo{},
					Methods:    []ImplementationInfo{},
				}
			}

			pkgInfo := result.Packages[packagePath]

			// 解析接口和结构体
			ast.Inspect(node, func(n ast.Node) bool {
				switch decl := n.(type) {
				case *ast.GenDecl:
					if decl.Tok == token.TYPE {
						for _, spec := range decl.Specs {
							if typeSpec, ok := spec.(*ast.TypeSpec); ok {
								// 解析接口
								if interfaceType, ok := typeSpec.Type.(*ast.InterfaceType); ok {
									interfaceInfo := InterfaceInfo{
										Name:     typeSpec.Name.Name,
										Line:     getLineFromPos(fset, typeSpec.Pos()),
										FilePath: path,
										Methods:  []MethodInfo{},
									}

									// 解析接口方法
									for _, field := range interfaceType.Methods.List {
										if len(field.Names) > 0 {
											// 命名方法
											for _, name := range field.Names {
												methodInfo := MethodInfo{
													Name:     name.Name,
													Line:     getLineFromPos(fset, field.Pos()),
													FilePath: path,
												}
												interfaceInfo.Methods = append(interfaceInfo.Methods, methodInfo)
											}
										} else {
											// 嵌入接口
											typeName, _ := getTypeNameFromExpr(field.Type)
											if typeName != "" {
												interfaceInfo.InternalType = typeName
											}
										}
									}

									pkgInfo.Interfaces = append(pkgInfo.Interfaces, interfaceInfo)
								}

								// 解析结构体
								if structType, ok := typeSpec.Type.(*ast.StructType); ok {
									structInfo := StructInfo{
										Name:     typeSpec.Name.Name,
										Line:     getLineFromPos(fset, typeSpec.Pos()),
										FilePath: path,
										Fields:   []FieldInfo{},
									}

									// 解析结构体字段
									for _, field := range structType.Fields.List {
										typeName, isPointer := getTypeNameFromExpr(field.Type)

										if len(field.Names) == 0 {
											// 嵌入字段
											fieldInfo := FieldInfo{
												Name:      typeName, // 嵌入字段名与类型相同
												Type:      typeName,
												Line:      getLineFromPos(fset, field.Pos()),
												FilePath:  path,
												Embedded:  true,
												IsPointer: isPointer,
											}
											structInfo.Fields = append(structInfo.Fields, fieldInfo)
										} else {
											// 命名字段
											for _, name := range field.Names {
												fieldInfo := FieldInfo{
													Name:      name.Name,
													Type:      typeName,
													Line:      getLineFromPos(fset, field.Pos()),
													FilePath:  path,
													Embedded:  false,
													IsPointer: isPointer,
												}
												structInfo.Fields = append(structInfo.Fields, fieldInfo)
											}
										}
									}

									pkgInfo.Structs = append(pkgInfo.Structs, structInfo)
								}
							}
						}
					}

				case *ast.FuncDecl:
					// 解析方法实现
					if decl.Recv != nil && len(decl.Recv.List) > 0 {
						recvField := decl.Recv.List[0]
						typeName, isPointer := getTypeNameFromExpr(recvField.Type)

						if typeName != "" {
							methodInfo := ImplementationInfo{
								ReceiverType: typeName,
								MethodName:   decl.Name.Name,
								Line:         getLineFromPos(fset, decl.Pos()),
								FilePath:     path,
								IsPointer:    isPointer,
							}
							pkgInfo.Methods = append(pkgInfo.Methods, methodInfo)
						}
					}
				}
				return true
			})

			// 更新包信息
			result.Packages[packagePath] = pkgInfo
		}

		return nil
	}

	// 处理主目录
	if err := processDir(dirPath); err != nil {
		return result, err
	}

	// 如果结果为空，尝试扫描相邻目录
	if len(result.Packages) == 0 {
		parentDir := filepath.Dir(dirPath)
		if parentDir != dirPath {
			// 处理父目录，尝试查找包
			_ = processDir(parentDir)
		}
	}

	return result, nil
}

// 分析指定文件和相关包
func analyzeFile(filePath string) (ParseResult, error) {
	// 获取文件所在目录
	dirPath := filepath.Dir(filePath)
	return parseDirectory(dirPath)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "用法: %s <go文件路径>\n", os.Args[0])
		os.Exit(1)
	}

	filePath := os.Args[1]
	result, err := analyzeFile(filePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "分析失败: %v\n", err)
		os.Exit(1)
	}

	// 输出JSON结果
	jsonResult, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "JSON编码失败: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(string(jsonResult))
}
