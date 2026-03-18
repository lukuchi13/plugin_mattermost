// webapp/src/ScheduleModal.jsx
import React from 'react';

class ScheduleModal extends React.PureComponent {
    constructor(props) {
        super(props);
        this.state = {
            show: false,
            selectedDate: new Date(),
            message: '',
            selectedDateTime: new Date()
        };
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

    schedule = () => {
        console.log('Scheduling message:', this.state);
        alert(`Message scheduled for: ${this.state.selectedDateTime}`);
        this.props.onClose && this.props.onClose();
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
                    width: '400px',
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

                    <div style={{display: 'flex', justifyContent: 'flex-end', gap: '10px'}}>
                        <button
                            onClick={() => this.setState({show: false})}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                background: 'none',
                                cursor: 'pointer'
                            }}
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
                                cursor: 'pointer'
                            }}
                        >
                            Schedule
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default ScheduleModal;
