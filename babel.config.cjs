// Babel is only used by Jest (Vite builds the app itself). Transforms ESM + JSX to CommonJS for tests.

// CommonJS has no `import.meta` (react-router reads import.meta.hot); stub it as an empty object.
const stubImportMeta = ({ types: t }) => ({
  visitor: {
    MetaProperty(path) {
      if (path.node.meta.name === "import") path.replaceWith(t.objectExpression([]));
    },
  },
});

module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    ["@babel/preset-react", { runtime: "automatic" }],
  ],
  plugins: [stubImportMeta],
};
