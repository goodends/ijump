# IJump - Go语言接口与实现快速跳转

这个 VS Code 扩展为 Go 语言的接口方法提供了快速跳转到实现的功能，同时也支持从实现跳转回接口定义。当您在编辑 Go 代码时，扩展会为接口方法和实现方法添加导航图标，帮助您轻松在代码中导航。

## 功能演示

![IJump功能演示](https://raw.githubusercontent.com/goodends/ijump/master/resources/image.png)

如上图所示，IJump 会在接口定义和方法实现的行首添加导航图标，鼠标悬停在图标上可以看到功能提示，点击即可快速跳转。

## 功能特性

- 自动识别 Go 语言接口中定义的方法
- 自动识别实现接口的结构体及其方法
- 在接口定义和方法处显示导航图标
- 在实现方法处显示导航图标
- 支持双向跳转（接口 ↔ 实现）
- 智能识别接口和实现关系
- 支持服务/仓库结构体的识别

## 使用方法

1. 安装扩展后，打开任意 Go 语言文件
2. 当您打开包含接口定义或实现的文件时，扩展会自动分析并显示导航图标
3. 在接口方法左侧会出现一个【向右】跳转图标，点击可跳转到实现
4. 在实现方法左侧会出现一个【向上】跳转图标，点击可跳转回接口定义
5. 将鼠标悬停在图标上可以查看更多信息

## 跨文件支持

IJump 能够自动分析同一个包内的所有 Go 文件，这意味着：

- 即使接口和实现位于不同文件中，也能正确识别它们之间的关系
- 可以从一个文件中的接口跳转到另一个文件中的实现
- 可以从实现代码跳转回不同文件中的接口定义
- 适用于复杂项目结构，如服务层接口与实现分离的架构

## 新增特性：注释声明接口实现关系

在2.0版本中，您可以通过注释显式声明某个结构体实现了特定接口：

```go
// ensure MyService implements Service
type MyService struct {
    // ...
}
```

这对于复杂类型关系或框架用法特别有用，能显著提高识别准确性。

## 示例

**接口文件 (service.go):**
```go
package auth

type Service interface {
    Login(ctx context.Context, email, password string) (*LoginResponse, error) // 此行会显示跳转图标
    RefreshToken(ctx context.Context, token string) (*TokenInfo, error)        // 此行会显示跳转图标
}
```

**实现文件 (service_impl.go):**
```go
package auth

// ensure AuthService implements Service
type AuthService struct {
    // ...
}

// 此行会显示跳转图标，可跳回接口定义
func (s *AuthService) Login(ctx context.Context, email, password string) (*LoginResponse, error) {
    // 实现代码...
}

// 此行会显示跳转图标，可跳回接口定义
func (s *AuthService) RefreshToken(ctx context.Context, token string) (*TokenInfo, error) {
    // 实现代码...
}
```

## 安装

有两种方法安装此扩展:

1. 在 VS Code 扩展市场中搜索 "IJump"，然后点击安装
2. 或者在命令行中运行: `code --install-extension ijump-2.0.0.vsix`

## 要求

- VS Code 1.96.0 或更高版本
- Go 语言支持

## 扩展设置

此扩展不需要额外的设置，开箱即用。

## 已知问题

- 极其复杂的接口实现关系可能需要更长的分析时间
- 在非常大的文件中性能可能会略有下降

如果您发现任何问题，请在 GitHub 仓库中提交 issue。

## 发布说明

### 2.0.0 (2024-04-03)

- **新功能**: 增强的接口实现检测算法，提高识别准确性
- **新功能**: 支持通过注释显式声明接口实现关系
- **新功能**: 增加对Go嵌入字段的特殊支持
- **优化**: 改进UI，移除对普通字段的装饰，保持界面简洁
- **优化**: 间接实现检测，识别组合关系实现的接口
- **优化**: 完善的工作流程文档和代码注释
- **修复**: 各种边缘情况的处理和稳定性改进

### 1.0.0 (2024-04-03)

- **新功能**: 跨文件分析接口和实现关系
- **新功能**: 同一包内的所有文件会被自动分析
- **优化**: 改进了接口与实现的匹配算法
- **优化**: 接口和实现之间的双向跳转
- **优化**: 提高了大型项目中的分析效率

### 0.1.1 (2024-04-03)

- **修复**: 更新文档，修复图片显示问题
- **优化**: 细节调整和代码清理
- **改进**: 提升与VS Code扩展市场的兼容性

### 0.1.0 (2024-04-03)

- **新功能**: 跨文件分析接口和实现关系
- **新功能**: 同一包内的所有文件会被自动分析
- **优化**: 改进了接口与实现的匹配算法
- **优化**: 接口和实现之间的双向跳转
- **优化**: 提高了大型项目中的分析效率

### 0.0.1 (2024-04-02)

- 初始版本发布
- 支持Go语言接口方法跳转到实现功能
- 在接口方法行首显示跳转图标

---

**享受更高效的Go语言开发体验!**
