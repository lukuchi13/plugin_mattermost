const path = require('path');

module.exports = {
    entry: './src/index.jsx',
    output: {
        path: path.join(__dirname, 'dist'),
        filename: 'com.yourdomain.scheduler_bundle.js',
        libraryTarget: 'umd',
        library: 'plugin',
        umdNamedDefine: true,
        globalObject: 'this'
    },
    module: {
        rules: [
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            '@babel/preset-env',
                            ['@babel/preset-react', { runtime: 'automatic' }]
                        ]
                    }
                }
            }
        ]
    },
    resolve: {
        extensions: ['.js', '.jsx']
    },
    externals: {
        react: 'react',
        'react-dom': 'react-dom',
        redux: 'redux'
    },
    mode: 'production'
};
