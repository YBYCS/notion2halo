这是一个同步方案用来将notion文章同步到halo博客，现有的方案导航有问题，所以自己写了一个。


项目地址：[https://github.com/YBYCS/notion2halo](https://github.com/YBYCS/notion2halo)


克隆后创建config.json和.setting.env两个文件


config.json


```javascript
{
    "site": {
        "url": "http://ip:8080",
        "attachment": {
            "policy": "default-policy",
            "group": ""
        }
    },
    "auth": {
        "username": "",
        "password": ""
    }
}
```


填入相关信息，group没有就不填


.setting.env


```javascript
# Notion
NOTION_TOKEN=
NOTION_DATABASE_ID=
```


[https://github.com/elog-x/notion-halo](https://github.com/elog-x/notion-halo)


notion配置参考以上内容中的配置 Notion 关键信息部分


主要就是令牌获取和复制他的数据库，然后把文章复制到这个数据库下，然后要发布记得将后面的内容勾选status设置为已发布啥的。


最后安装依赖 npm install


执行


node app.js


注意由于我本人不需要使用分类等内容，如果设置了可能会报错，或者没有正确分类之类的，可以自行修改push2halo函数


相关修改可以参考


[https://github.com/elijaholmos/halo-notion-extension](https://github.com/elijaholmos/halo-notion-extension)


中的haloservice类里的publish函数

