import React from "react";
import { Card, Tabs } from "@shopify/polaris";
import Background from "./background";
import Drop from "./drop";
import './App.css'

export default class Index extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      selected: 0,
      tabs: [
        {
          id: "background",
          content: "Background Images",
          panelID: <Background />
        },
        {
          id: "drop",
          content: "Drop Images",
          panelID: <Drop />
        }
      ]
    };
  }

  handleTabChange = index => {
    this.setState({ selected: index });
  };
  render() {
    return (
      <Tabs
        tabs={this.state.tabs}
        selected={this.state.selected}
        onSelect={this.handleTabChange}
      >
        <Card.Section>
          {this.state.tabs[this.state.selected].panelID}
        </Card.Section>
      </Tabs>
    );
  }
}
