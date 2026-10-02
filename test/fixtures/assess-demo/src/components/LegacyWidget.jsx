import React, { Component } from 'react';

export default class LegacyWidget extends Component {
  constructor(props) {
    super(props);
    this.state = { count: 0 };
  }

  render() {
    return (
      <div
        onClick={() => this.setState({ count: this.state.count + 1 })}
      >
        legacy count: {this.state.count}
      </div>
    );
  }
}
