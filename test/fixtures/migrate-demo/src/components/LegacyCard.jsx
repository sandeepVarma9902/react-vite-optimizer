import React from 'react';

export default class LegacyCard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { liked: false };
  }

  toggle = () => {
    this.setState({ liked: !this.state.liked });
  };

  render() {
    return (
      <div className="card">
        <p>{this.props.title}</p>
        {this.state.liked ? <span>Liked!</span> : <span>Meh</span>}
        <button onClick={this.toggle}>Toggle</button>
      </div>
    );
  }
}
