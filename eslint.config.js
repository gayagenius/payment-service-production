export default [
  {
    files: ["*.js", "*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      // add more rules as needed
    },
    ignores: ["node_modules/**"]
  }
];
