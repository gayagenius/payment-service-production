# 📚 Documentation Deployment Guide

This guide explains how to host the Swagger API documentation on GitHub Pages for easy access by other services.

## 🚀 Quick Setup

### 1. Enable GitHub Pages
1. Go to your repository settings
2. Navigate to "Pages" section
3. Set source to "GitHub Actions"
4. Save the settings

### 2. Deploy Documentation
```bash
# Build documentation locally
npm run build:docs

# Commit and push changes
git add docs/
git commit -m "docs: update API documentation"
git push origin main
```

### 3. Access Documentation
- **Live URL**: `https://your-username.github.io/payment-service-production/`
- **Local Preview**: Open `docs/index.html` in your browser

## 🔧 Features

### ✅ **Automatic Deployment**
- Documentation updates automatically when you push to `main` branch
- GitHub Actions workflow handles the build and deployment
- No manual intervention required

### ✅ **Interactive Swagger UI**
- Full Swagger UI interface with try-it-out functionality
- Real-time API testing capabilities
- Beautiful, responsive design

### ✅ **Rich Documentation**
- Custom header with service information
- Quick start guide and feature highlights
- Performance metrics and scalability info
- Integration examples (cURL, JavaScript)

### ✅ **Version Control**
- Documentation is versioned with your code
- PR previews show documentation changes
- Easy rollback if needed

## 📋 Available Endpoints

The documentation includes all API endpoints:

- **POST /payments** - Create payment with retry support
- **GET /payments/{id}** - Get payment details
- **POST /payments/{id}/refund** - Process refund
- **GET /payments/user/{userId}** - Get user payments
- **GET /payment-history/{paymentId}** - Get payment history
- **GET /payment-history/user/{userId}** - Get user payment history

## 🔧 Customization

### Update Base URL
Edit the base URL in the generated documentation:

1. Open `scripts/build-docs.js`
2. Find the base URL configuration
3. Update with your production domain
4. Rebuild documentation

### Add Custom Domain
1. Add a `CNAME` file to the `docs/` directory
2. Update the GitHub Actions workflow with your domain
3. Configure DNS settings with your domain provider

### Customize Styling
The documentation uses custom CSS that can be modified in `scripts/build-docs.js`:

```css
.custom-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  /* Add your custom styles here */
}
```

## 🚀 Integration for Other Services

### 1. **Direct API Access**
Other services can access the API documentation at:
```
https://your-username.github.io/payment-service-production/
```

### 2. **OpenAPI Specification**
Raw OpenAPI spec available at:
```
https://your-username.github.io/payment-service-production/openapi.yaml
```

### 3. **Code Generation**
Use the OpenAPI spec to generate client libraries:

```bash
# Generate JavaScript client
npx @openapitools/openapi-generator-cli generate \
  -i https://your-username.github.io/payment-service-production/openapi.yaml \
  -g javascript \
  -o ./payment-client

# Generate Python client
npx @openapitools/openapi-generator-cli generate \
  -i https://your-username.github.io/payment-service-production/openapi.yaml \
  -g python \
  -o ./payment-client
```

### 4. **API Testing**
Use tools like Postman or Insomnia to import the OpenAPI spec:

1. Import from URL: `https://your-username.github.io/payment-service-production/openapi.yaml`
2. Set up environment variables
3. Start testing the API

## 📊 Monitoring

### GitHub Actions
- Check the "Actions" tab in your repository
- Monitor deployment status
- View build logs if issues occur

### Documentation Analytics
- GitHub Pages provides basic analytics
- Monitor page views and popular endpoints
- Track usage patterns

## 🔄 Updates

### Automatic Updates
- Documentation updates when you push changes to `api/openapi.yaml`
- GitHub Actions automatically rebuilds and deploys
- Changes are live within minutes

### Manual Updates
```bash
# Make changes to API spec
vim api/openapi.yaml

# Build and test locally
npm run build:docs

# Commit and push
git add .
git commit -m "feat: add new endpoint"
git push origin main
```

## 🛠️ Troubleshooting

### Common Issues

#### 1. **Documentation Not Updating**
- Check GitHub Actions workflow status
- Ensure you're pushing to `main` branch
- Verify file paths in workflow

#### 2. **Swagger UI Not Loading**
- Check browser console for errors
- Verify OpenAPI spec is valid
- Ensure all required files are present

#### 3. **Styling Issues**
- Clear browser cache
- Check CSS file paths
- Verify custom styles are applied

### Debug Commands
```bash
# Validate OpenAPI spec
npx swagger-codegen-cli validate -i api/openapi.yaml

# Test local build
npm run build:docs
open docs/index.html

# Check GitHub Actions logs
# Go to Actions tab in GitHub repository
```

## 📞 Support

For issues with documentation deployment:

1. Check GitHub Actions logs
2. Verify repository settings
3. Create an issue in the repository
4. Contact the development team

## 🎯 Best Practices

### ✅ **Do**
- Keep API documentation up to date
- Use descriptive endpoint names
- Provide comprehensive examples
- Test documentation locally before pushing

### ❌ **Don't**
- Commit sensitive information
- Use hardcoded production URLs in examples
- Ignore validation errors
- Deploy without testing

---

## 🚀 Ready to Deploy!

Your Swagger documentation is now ready for GitHub Pages hosting. Other services can easily discover, understand, and integrate with your Payment Service API through the beautiful, interactive documentation.

**Next Steps:**
1. Enable GitHub Pages in repository settings
2. Push your changes to trigger deployment
3. Share the documentation URL with other teams
4. Monitor usage and gather feedback
