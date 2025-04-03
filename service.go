package auth

import (
	"context"
	"time"

	"group-bestStructure/internal/user"
	"group-bestStructure/pkg/errors"
	"group-bestStructure/pkg/logger"
)

// 添加本地常量定义，避免循环依赖
const (
// 其他常量保留
)

// 错误映射到基础架构层的错误码
var (
	// 用户认证相关错误，使用errors包中的错误码
	ErrInvalidCredentials  = errors.New(errors.ErrCodeInvalidCredentials)
	ErrTokenExpired        = errors.New(errors.ErrCodeTokenExpired)
	ErrTokenInvalid        = errors.New(errors.ErrCodeInvalidToken)
	ErrTokenRevoked        = errors.New(errors.ErrCodeTokenRevoked)
	ErrUserLocked          = errors.New(errors.ErrCodeAccountLocked)
	ErrUserDisabled        = errors.New(errors.ErrCodeAccountDisabled)
	ErrUserNotVerified     = errors.New(errors.ErrCodeVerificationRequired)
	ErrRefreshTokenInvalid = errors.New(errors.ErrCodeInvalidRefreshToken)
	ErrConfigurationError  = errors.New(errors.ErrCodeBadRequest).WithMessage("系统配置错误")
)

// AuthConfig 认证配置
type AuthConfig struct {
	AccessTokenSecret  string        // 访问令牌密钥
	RefreshTokenSecret string        // 刷新令牌密钥
	AccessTokenExpiry  time.Duration // 访问令牌有效期
	RefreshTokenExpiry time.Duration // 刷新令牌有效期
	Issuer             string        // 颁发者
}

// Service 认证服务接口
type Service interface {
	// Login 用户登录
	Login(ctx context.Context, email, password string) (*LoginResponse, error)

	// RefreshToken 刷新访问令牌
	RefreshToken(ctx context.Context, refreshToken string, fingerprint string) (*LoginResponse, error)

	// Logout 用户登出
	Logout(ctx context.Context, refreshToken string) error

	// ValidateToken 验证令牌
	ValidateToken(ctx context.Context, tokenString string) (*TokenInfo, error)

	// LogoutAllDevices 登出所有设备
	LogoutAllDevices(ctx context.Context, userID string) error

	// 第二阶段新增方法
	// 设备管理
	GetUserDevices(ctx context.Context, userID string) (*DeviceListResponse, error)
	RevokeDevice(ctx context.Context, userID string, deviceID string) error
	UpdateDeviceInfo(ctx context.Context, userID string, req *UpdateDeviceRequest) error

	// 令牌管理
	IsTokenRevoked(ctx context.Context, tokenValue string) (bool, error)
	GetUserTokenStats(ctx context.Context, userID string) ([]*TokenStat, error)
	GetUserTokenAuditLogs(ctx context.Context, userID string, limit int) ([]*TokenAuditLog, error)

	// 缓存管理
	InvalidateTokenCache(ctx context.Context, tokenValue string) error

	// 系统管理
	CleanupExpiredTokens(ctx context.Context) (int64, error)
	CleanupBlacklist(ctx context.Context) (int64, error)
}

// AuthService 认证服务实现
type AuthService struct {
	config      *AuthConfig
	repository  Repository
	userService user.Service
	userRepo    user.Repository
	log         *logger.Logger
}

// NewService 创建新的认证服务
func NewService(
	config *AuthConfig,
	repository Repository,
	userService user.Service,
	userRepo user.Repository,
) Service {
	log := logger.WithFields(map[string]interface{}{
		"module": "auth_service",
	})

	return &AuthService{
		config:      config,
		repository:  repository,
		userService: userService,
		userRepo:    userRepo,
		log:         log,
	}
}

