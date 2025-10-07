
const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : undefined,
    formatters: {
        level: (label) => {
            return { level: label };
        }
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
        req: (req) => ({
            method: req.method,
            url: req.url,
            user: req.user?.id
        }),
        res: (res) => ({
            statusCode: res.statusCode
        }),
        err: pino.stdSerializers.err
    },
    // redact: {
    //     paths: ['req.headers.authorization', 'password', 'token', 'privateKey', 'secret'],
    //     remove: true
    // }
})

module.exports = logger;