# Change Log

All notable changes to the "ijump" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0] - 2024-04-03

### 新增功能
- 支持同一包内跨文件分析接口和实现关系
- 自动扫描包内所有Go文件
- 双向导航：从接口跳转到实现，或从实现跳转回接口

### 改进
- 改进了接口与实现的匹配算法
- 优化了大型项目中的分析性能
- 增强了悬停提示信息

## [0.0.1] - 2024-04-02

- 初始版本发布
- 支持Go语言接口方法跳转到实现功能
- 在接口方法行首显示跳转图标