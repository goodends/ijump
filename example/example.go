package example

// Reader 是一个读取数据的接口
type Reader interface {
	Read(p []byte) (n int, err error)
	Close() error
}

// Writer 是一个写入数据的接口
type Writer interface {
	Write(p []byte) (n int, err error)
	Close() error
}

// FileReader 实现了 Reader 接口
type FileReader struct {
	path string
}

// Read 实现了 Reader 接口的 Read 方法
func (f *FileReader) Read(p []byte) (n int, err error) {
	// 示例实现
	return len(p), nil
}

// Close 实现了 Reader 接口的 Close 方法
func (f *FileReader) Close() error {
	// 示例实现
	return nil
}

// NetworkReader 也实现了 Reader 接口
type NetworkReader struct {
	url string
}

// Read 实现了 Reader 接口的 Read 方法
func (n *NetworkReader) Read(p []byte) (int, error) {
	// 示例网络读取实现
	return len(p), nil
}

// Close 实现了 Reader 接口的 Close 方法
func (n *NetworkReader) Close() error {
	// 示例实现
	return nil
}

// FileWriter 实现了 Writer 接口
type FileWriter struct {
	path string
}

// Write 实现了 Writer 接口的 Write 方法
func (f *FileWriter) Write(p []byte) (n int, err error) {
	// 示例实现
	return len(p), nil
}

// Close 实现了 Writer 接口的 Close 方法
func (f *FileWriter) Close() error {
	// 示例实现
	return nil
}
