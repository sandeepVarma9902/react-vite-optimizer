import React from 'react';
import { useRoutes } from 'react-router-dom';
import { accountRoutes } from './accountRoutes.js';

function renderable(routes) {
  return routes.map(r => ({
    ...r,
    element: r.element ? React.createElement(r.element) : undefined,
    children: r.children ? renderable(r.children) : undefined,
  }));
}

export default function AccountRoutes() {
  return useRoutes(renderable(accountRoutes));
}
