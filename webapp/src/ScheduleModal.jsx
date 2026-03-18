import React from 'react';

class ScheduleModal extends React.PureComponent {
    constructor(props) {
        super(props);
        this.state = {
            show: false,
            selectedDate: new Date(),
            message: '',
            selectedDateTime: new Date(),
            files: [],
            uploading: false
        };
        this.fileInputRef = React.createRef();
    }

    handleDateChange = (e) => {
        this.setState({selectedDate: e.target.value});
    }

    handleMessageChange = (e) => {
        this.setState({message: e.target.value});
    }

    handleDateTimeChange = (e) => {
        this.setState({selectedDateTime: new Date(e.target.value)});
    }

    handleFileSelect = (e) => {
        const selectedFiles = Array.from(e.target.files);
        this.setState(prevState => ({
            files: [...prevState.files, ...selectedFiles]
        }));
    }

    removeFile = (indexToRemove) => {
        this.setState(prevState => ({
            files: prevState.files.filter((_, index) => index !== indexToRemove)
        }));
    }

    schedule = async () => {
        if (!this.state.message && this.state.files.length === 0) {
            alert('Please enter a message or attach files');
            return;
        }

        this.setState({uploading: true});

        try {
            const channelId = this.props.channelId;
            const userId = this.props.currentUserId;

            const formData = new FormData();
            formData.append('user_id', userId);
            formData.append('channel_id', channelId);
            formData.append('message', this.state.message);
            formData.append('schedule_time', this.state.selectedDateTime.toISOString());

            this.state.files.forEach((file) => {
                formData.append(`files`, file);
            });

            const response = await fetch('/plugins/ukuchi.scheduler/api/v1/schedule', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                alert(`Message scheduled for: ${this.state.selectedDateTime.toLocaleString()}\nFiles attached: ${this.state.files.length}`);
                this.setState({
                    show: false,
                    message: '',
                    files: [],
                    selectedDateTime: new Date()
                });
                this.props.onClose && this.props.onClose();
            } else {
                const error = await response.text();
                alert(`Error scheduling message: ${error}`);
            }
        } catch (error) {
            console.error('Error scheduling message:', error);
            alert('Failed to schedule message');
        } finally {
            this.setState({uploading: false});
        }
    }

    render() {
        if (!this.state.show) {
            return null;
        }

        return (
            <div className="modal" style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000
            }}>
                <div className="modal-content" style={{
                    backgroundColor: '#fff',
                    padding: '20px',
                    borderRadius: '8px',
                    width: '500px',
                    maxWidth: '90%'
                }}>
                    <h2 style={{marginBottom: '20px'}}>Schedule Message</h2>

                    <div style={{marginBottom: '15px'}}>
                        <label style={{display: 'block', marginBottom: '5px'}}>
                            Select Date and Time:
                        </label>
                        <input
                            type="datetime-local"
                            onChange={this.handleDateTimeChange}
                            style={{
                                width: '100%',
                                padding: '8px',
                                borderRadius: '4px',
                                border: '1px solid #ccc'
                            }}
                        />
                    </div>

                    <div style={{marginBottom: '15px'}}>
                        <label style={{display: 'block', marginBottom: '5px'}}>
                            Your Message:
                        </label>
                        <textarea
                            value={this.state.message}
                            onChange={this.handleMessageChange}
                            placeholder="Enter your message..."
                            style={{
                                width: '100%',
                                padding: '8px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                minHeight: '100px'
                            }}
                        />
                    </div>

                    <div style={{marginBottom: '15px'}}>
                        <label style={{display: 'block', marginBottom: '5px'}}>
                            Attachments:
                        </label>

                        <input
                            type="file"
                            ref={this.fileInputRef}
                            onChange={this.handleFileSelect}
                            multiple
                            style={{display: 'none'}}
                        />

                        <button
                            onClick={() => this.fileInputRef.current.click()}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                background: '#f5f5f5',
                                cursor: 'pointer',
                                marginBottom: '10px'
                            }}
                        >
                            📎 Choose Files
                        </button>

                        {this.state.files.length > 0 && (
                            <div style={{
                                border: '1px solid #eee',
                                borderRadius: '4px',
                                padding: '10px',
                                maxHeight: '150px',
                                overflowY: 'auto'
                            }}>
                                {this.state.files.map((file, index) => (
                                    <div key={index} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '5px',
                                        borderBottom: '1px solid #f0f0f0'
                                    }}>
                                        <span style={{
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            maxWidth: '300px'
                                        }}>
                                            📄 {file.name} ({(file.size / 1024).toFixed(1)} KB)
                                        </span>
                                        <button
                                            onClick={() => this.removeFile(index)}
                                            style={{
                                                border: 'none',
                                                background: 'none',
                                                color: '#ff4444',
                                                cursor: 'pointer',
                                                fontSize: '18px',
                                                padding: '0 5px'
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{display: 'flex', justifyContent: 'flex-end', gap: '10px'}}>
                        <button
                            onClick={() => this.setState({show: false, files: []})}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                background: 'none',
                                cursor: 'pointer'
                            }}
                            disabled={this.state.uploading}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={this.schedule}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '4px',
                                border: 'none',
                                background: '#0066cc',
                                color: 'white',
                                cursor: this.state.uploading ? 'wait' : 'pointer',
                                opacity: this.state.uploading ? 0.7 : 1
                            }}
                            disabled={this.state.uploading}
                        >
                            {this.state.uploading ? 'Scheduling...' : 'Schedule'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default ScheduleModal;