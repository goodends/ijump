package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt"

	"group-bestStructure/pkg/errors"
	"group-bestStructure/pkg/logger"
)

// ValidateToken 验证访问令牌
func (s *AuthService) ValidateToken(ctx context.Context, tokenString string) (*TokenInfo, error) {
	s.log.Debug("验证令牌", logger.String("token", maskToken(tokenString)))

	// 验证令牌字符串格式
	if tokenString == "" {
		return nil, ErrTokenInvalid
	}

	// 检查令牌是否已撤销
	token, err := s.repository.GetTokenByValue(ctx, tokenString)
	if err != nil {
		s.log.Error("获取令牌信息失败", logger.Err(err))
		return nil, errors.Wrap(err, errors.ErrCodeDatabaseError)
	}

	if token == nil {
		s.log.Warn("令牌不存在")
		return nil, ErrTokenInvalid
	}

	if token.Status == TokenStatusRevoked {
		s.log.Warn("令牌已被撤销", logger.String("user_id", token.UserID))
		return nil, ErrTokenRevoked
	}

	// 检查令牌是否过期
	now := time.Now()
	if now.After(token.ExpiresAt) {
		s.log.Warn("令牌已过期",
			logger.String("user_id", token.UserID),
			logger.Time("expires_at", token.ExpiresAt))

		// 更新令牌状态为过期
		if err := s.repository.RevokeToken(ctx, tokenString); err != nil {
			s.log.Error("更新过期令牌状态失败",
				logger.String("user_id", token.UserID),
				logger.Err(err))
		}

		return nil, ErrTokenExpired
	}

	// 检查令牌是否在黑名单中
	isBlacklisted, reason, err := s.repository.IsTokenBlacklisted(ctx, tokenString)
	if err != nil {
		s.log.Error("检查令牌黑名单状态失败",
			logger.String("token", maskToken(tokenString)),
			logger.Err(err))
		// 不中断验证流程，仅记录错误
	}

	if isBlacklisted {
		s.log.Warn("令牌在黑名单中",
			logger.String("token", maskToken(tokenString)),
			logger.String("reason", string(reason)))
		return nil, ErrTokenRevoked
	}

	// 记录令牌访问
	// 尝试查找设备ID
	deviceID := ""
	devices, err := s.repository.GetUserDevices(ctx, token.UserID)
	if err == nil && len(devices) > 0 {
		for _, device := range devices {
			if device.CurrentToken == tokenString {
				deviceID = device.DeviceID
				break
			}
		}
	}

	// 记录令牌访问统计
	_ = s.repository.RecordTokenAccess(ctx, tokenString, token.UserID, deviceID)

	// 验证JWT
	claims := &struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		jwt.StandardClaims
	}{}

	jwtKey := []byte(s.config.AccessTokenSecret)
	if token.TokenKind == RefreshToken {
		jwtKey = []byte(s.config.RefreshTokenSecret)
	}

	jwtToken, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		// 验证签名算法
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			s.log.Warn("无效的令牌签名方法",
				logger.String("method", token.Method.Alg()))
			return nil, fmt.Errorf("无效的签名方法: %v", token.Header["alg"])
		}
		return jwtKey, nil
	})

	if err != nil {
		if ve, ok := err.(*jwt.ValidationError); ok {
			if ve.Errors&jwt.ValidationErrorExpired != 0 {
				s.log.Warn("JWT令牌已过期", logger.Err(err))
				return nil, ErrTokenExpired
			}
		}
		s.log.Error("解析JWT令牌失败", logger.Err(err))
		return nil, ErrTokenInvalid
	}

	if !jwtToken.Valid {
		s.log.Warn("无效的JWT令牌")
		return nil, ErrTokenInvalid
	}

	// 返回令牌信息
	var email string
	user, err := s.userRepo.GetUserByID(ctx, token.UserID)
	if err == nil && user != nil {
		email = user.Email
	}

	tokenInfo := &TokenInfo{
		UserID:    token.UserID,
		Email:     email,
		ExpiresAt: claims.ExpiresAt,
		IssuedAt:  claims.IssuedAt,
	}

	s.log.Info("令牌验证成功",
		logger.String("user_id", tokenInfo.UserID),
		logger.String("email", tokenInfo.Email))

	return tokenInfo, nil
}

// IsTokenRevoked 检查令牌是否已被撤销
func (s *AuthService) IsTokenRevoked(ctx context.Context, tokenValue string) (bool, error) {
	s.log.Debug("检查令牌是否被撤销", logger.String("token", maskToken(tokenValue)))

	// 从数据库检查令牌状态
	token, err := s.repository.GetTokenByValue(ctx, tokenValue)
	if err != nil {
		s.log.Error("获取令牌信息失败", logger.Err(err))
		return false, errors.Wrap(err, errors.ErrCodeDatabaseError)
	}

	// 如果令牌不存在，认为已撤销
	if token == nil {
		return true, nil
	}

	// 检查令牌状态
	if token.Status == TokenStatusRevoked {
		return true, nil
	}

	// 检查令牌是否过期
	if time.Now().After(token.ExpiresAt) {
		return true, nil
	}

	// 检查令牌是否在黑名单中
	isBlacklisted, _, err := s.repository.IsTokenBlacklisted(ctx, tokenValue)
	if err != nil {
		s.log.Error("检查令牌黑名单状态失败", logger.Err(err))
		// 发生错误时，为安全起见，假设令牌有效
		return false, errors.Wrap(err, errors.ErrCodeDatabaseError)
	}

	return isBlacklisted, nil
}

// InvalidateTokenCache 使令牌缓存无效
func (s *AuthService) InvalidateTokenCache(ctx context.Context, tokenValue string) error {
	s.log.Debug("使令牌缓存无效", logger.String("token", maskToken(tokenValue)))
	// 这里实现缓存失效逻辑，在需要时可以向Repository接口添加对应方法
	return nil
}

// generateAccessToken 生成访问令牌
func (s *AuthService) generateAccessToken(userID, email string, fingerprintHash string) (string, error) {
	expirationTime := time.Now().Add(s.config.AccessTokenExpiry)
	claims := &jwt.StandardClaims{
		ExpiresAt: expirationTime.Unix(),
		IssuedAt:  time.Now().Unix(),
		Issuer:    s.config.Issuer,
		Subject:   userID,
		Id:        fingerprintHash,
		Audience:  email,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(s.config.AccessTokenSecret))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

// maskToken 对令牌进行掩码处理，用于日志记录
func maskToken(token string) string {
	if len(token) < 10 {
		return "***"
	}
	return token[0:5] + "..." + token[len(token)-5:]
}
