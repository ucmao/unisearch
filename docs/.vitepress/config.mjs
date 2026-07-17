import {defineConfig} from 'vitepress'
import {withMermaid} from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(defineConfig({
    title: "MediaRadar自媒体爬虫",
    description: "小红书爬虫，抖音爬虫， 快手爬虫， B站爬虫， 微博爬虫，百度贴吧爬虫，知乎爬虫...。  ",
    lastUpdated: true,
    base: '/MediaRadar/',
    head: [
        [
            'script',
            {async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-5TK7GF3KK1'}
        ],
        [
            'script',
            {},
            `window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-5TK7GF3KK1');`
        ]
    ],
    themeConfig: {
        editLink: {
            pattern: 'https://github.com/NanmiCoder/MediaRadar/tree/main/docs/:path'
        },
        search: {
            provider: 'local'
        },
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            {text: '首页', link: '/'},
            {text: '联系我', link: '/作者介绍'},
            {text: '支持我', link: '/知识付费介绍'},
        ],

        sidebar: [
            {
                text: '作者介绍',
                link: '/作者介绍',
            },
            {
                text: 'MediaRadar使用文档',
                items: [
                    {text: '基本使用', link: '/'},
                    {text: '项目架构文档', link: '/项目架构文档'},
                    {text: '常见问题汇总', link: '/常见问题'},
                    {text: 'IP代理使用', link: '/代理使用'},
                    {text: '词云图使用', link: '/词云图使用配置'},
                    {text: '项目目录结构', link: '/项目代码结构'},
                    {text: '手机号登录说明', link: '/手机号登录说明'},
                ]
            },
            {
                text: '知识付费',
                items: [
                    {text: '知识付费介绍', link: '/知识付费介绍'},
                    {text: 'MediaRadarPro订阅', link: '/mediaradarpro订阅'},
                    {
                        text: 'MediaRadar源码剖析课',
                        link: 'https://relakkes.feishu.cn/wiki/JUgBwdhIeiSbAwkFCLkciHdAnhh'
                    },
                ]
            },
            {
                text: 'MediaRadar项目交流群',
                link: '/微信交流群',
            },
            {
                text: '爬虫入门教程分享',
                items: [
                    {text: "我写的爬虫入门教程", link: 'https://github.com/NanmiCoder/CrawlerTutorial'}
                ]
            },
            {
                text: 'MediaRadar捐赠名单',
                items: [
                    {text: "捐赠名单", link: '/捐赠名单'}
                ]
            },

        ],

        socialLinks: [
            {icon: 'github', link: 'https://github.com/NanmiCoder/MediaRadar'}
        ]
    }
}))
