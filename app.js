const axios = require('axios');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const markdownItAnchor = require('markdown-it-anchor');
const FormData = require('form-data');
const matter = require('gray-matter');
const { exec } = require('child_process');
const config = require('./config.json');


class PostContent {
    constructor() {
        this.site = config.site;
        this.apiClient = axios.create({
            baseURL: config.site.url,
            auth: config.auth,
        });
    }

    async getAttachmentPermalink(name) {
        const { data: policy } = await this.apiClient.get(
            `/apis/storage.halo.run/v1alpha1/policies/${this.site.attachment.policy}`
        );

        return new Promise((resolve, reject) => {
            const fetchPermalink = () => {
                this.apiClient
                    .get(`/apis/storage.halo.run/v1alpha1/attachments/${name}`)
                    .then((response) => {
                        const permalink = response.data.status.permalink;
                        if (permalink) {
                            if (policy.spec.templateName === "local") {
                                resolve(`${this.site.url}${permalink}`);
                            } else {
                                resolve(permalink);
                            }
                        } else {
                            setTimeout(fetchPermalink, 1000);
                        }
                    })
                    .catch((error) => reject(error));
            };
            fetchPermalink();
        });
    }

    async uploadImage(file) {
        const imageBuffer = fs.readFileSync(decodeURIComponent(file));

        try {
            const formData = new FormData();
            formData.append("file", imageBuffer, {
                filename: path.basename(decodeURIComponent(file)),
            });
            formData.append("policyName", this.site.attachment.policy);
            formData.append("groupName", this.site.attachment.group);

            const response = await this.apiClient.post(
                "/apis/api.console.halo.run/v1alpha1/attachments/upload",
                formData,
                {
                    headers: formData.getHeaders(),
                }
            );

            const permalink = await this.getAttachmentPermalink(
                response.data.metadata.name
            );

            return permalink;
        } catch (error) {
            console.error("Error uploading image:", error);
            return "";
        }
    }

    async uploadImagesFromMarkdown(mdFilePath) {
        const markdownText = fs.readFileSync(mdFilePath, 'utf8');
        const imageRegex = /!\[.*?\]\((.*?)\)/g;

        let match;
        const imagePaths = [];
        const matchedImages = [];

        while ((match = imageRegex.exec(markdownText)) !== null) {
            const imagePath = match[1];

            if (imagePath.startsWith('http')) {
                continue;
            }

            const absoluteImagePath = path.resolve(path.dirname(mdFilePath), imagePath);
            imagePaths.push({ path: imagePath, absolutePath: absoluteImagePath });
        }

        if (imagePaths.length === 0) {
            console.log('No images to upload.');
            return;
        }

        for (let i = 0; i < imagePaths.length; i++) {
            const imagePath = imagePaths[i];
            console.log(`Uploading ${i + 1}/${imagePaths.length}: ${imagePath.path}`);
            const permalink = await this.uploadImage(imagePath.absolutePath);
            matchedImages.push({ old: imagePath.path, new: permalink });
        }

        let newMarkdownText = markdownText;
        matchedImages.forEach(item => {
            newMarkdownText = newMarkdownText.replace(item.old, item.new);
        });

        fs.writeFileSync(mdFilePath, newMarkdownText);
        console.log('Upload images success!');
    }


    async createPost(markdownFilePath, title, publish, author) {
        const apiClient = this.apiClient;
        const markdownText = fs.readFileSync(path.resolve(__dirname, markdownFilePath), 'utf8');
        const { data, content } = matter(markdownText);

        // 创建一个markdown-it的实例
        const md = MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
        }).use(markdownItAnchor, {
            // 这里可以配置markdown-it-anchor的选项，例如permalink等
        });
        // 将Markdown文本转换为HTML
        const htmlContent = md.render(content);


        const postRequest = {
            post: {
                spec: {
                    title: data['title'], // use the title parameter
                    slug: data['title'].toLowerCase().split(' ').join('-'), // generate slug from title
                    template: "",
                    cover: "",
                    deleted: false,
                    publish: data['publish'], // use the publish parameter
                    publishTime: undefined,
                    pinned: false,
                    allowComment: true,
                    visible: "PUBLIC",
                    priority: 0,
                    excerpt: {
                        autoGenerate: true,
                        raw: "",
                    },
                    categories: data['categories'] || [],
                    tags: data['tags'] || [],
                    htmlMetas: [],
                },
                apiVersion: "content.halo.run/v1alpha1",
                kind: "Post",
                metadata: {
                    name: data['urlname'],
                    annotations: {
                    }
                },
            },
            content: {
                raw: content,
                content: htmlContent,
                rawType: "markdown",
            },
        };

        // 判断是否已有文章
        const hasPush = await this.isExist(data['urlname']);
        
        if (hasPush) {
            console.log('Post already exists, updating:', data['title']);
            try {
                const { name } = postRequest.post.metadata;
                let param = await this.getPost(name);

                
                param.post.spec.title = data['title'];
                param.post.spec.slug = this.slugify(data['title']);
                param.content = postRequest.content;

                await this.apiClient.put(
                    `/apis/content.halo.run/v1alpha1/posts/${name}`,
                    // JSON.stringify(postRequest.post)
                    // postRequest.post
                    param.post
                );

                await this.apiClient.put(
                    `/apis/api.console.halo.run/v1alpha1/posts/${name}/content`,
                    postRequest.content
                );
                
                if (data['publish']) {
                    await this.apiClient.put(
                        `/apis/api.console.halo.run/v1alpha1/posts/${postRequest.post.metadata.name}/publish`
                    );
                } else {
                    await this.apiClient.put(
                        `/apis/api.console.halo.run/v1alpha1/posts/${postRequest.post.metadata.name}/unpublish`
                    );
                }
            }
            catch (error) {
                if (error.response) {
                    console.error('Error status:', error.response.status);
                    console.error('Error data:', error.response.data);
                } else {
                    console.error('Error:', error);
                }
            }
            return;
        }
        else {
            console.log('Creating post:', data['title']);
            try {
                const response = await apiClient.post('/apis/api.console.halo.run/v1alpha1/posts', postRequest);
            } catch (error) {
                if (error.response) {
                    console.error('Error status:', error.response.status);
                    console.error('Error data:', error.response.data);
                } else {
                    console.error('Error:', error.message);
                }
            }
            return;
        }

    }

    async push2halo(filePath) {
        const title = path.basename(filePath, path.extname(filePath));
        await this.uploadImagesFromMarkdown(filePath);
        await this.createPost(filePath, title, true, 'ybycs');
    }

    async sync() {
        await new Promise((resolve, reject) => {
            exec('npm run download:notion', (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error executing script: ${error}`);
                    reject(error);
                    return;
                }
                console.log(`Script output: ${stdout}`);
                resolve();
            });
        });

        // 遍历./docs目录
        const files = fs.readdirSync('./docs');

        for (const file of files) {
            // 检查文件扩展名是否为.md
            if (path.extname(file) === '.md') {
                // 获取文件的相对路径
                const filePath = path.join('./docs', file);
                // 调用push2halo函数
                await this.push2halo(filePath);
            }
        }
    }

    async isExist(name) {
        try {
            const post = await this.apiClient.get(`/apis/api.console.halo.run/v1alpha1/posts`);
            return post.data.items.some((item) => item.post.metadata.name == name);
            
        } catch (error) {
            return false;
        }
    }

    async getPost(name) {


        try {
            const post = await this.apiClient.get(`/apis/content.halo.run/v1alpha1/posts/${name}`);
            const content = await this.apiClient.get(`/apis/api.console.halo.run/v1alpha1/posts/${name}/head-content`);
            return {
                post: post.data,
                content: content.data,
            };
        } catch (error) {
            return undefined;
        }
    }

    async getCategories() {
        const { data: categories } = await this.apiClient.get("/apis/content.halo.run/v1alpha1/categories");
        return Promise.resolve(categories.items);
    }

    slugify(name) {
        return name.toLowerCase().split(' ').join('-');
    }

    async getCategoryNames(displayNames) {
        const allCategories = await this.getCategories();

        const notExistDisplayNames = displayNames.filter(
            name => !allCategories.find(item => item.spec.displayName === name)
        );

        const promises = notExistDisplayNames.map((name, index) =>
            this.apiClient.post(
                "/apis/content.halo.run/v1alpha1/categories",
                {
                    spec: {
                        displayName: name,
                        slug: slugify(name, { trim: true }),
                        description: "",
                        cover: "",
                        template: "",
                        priority: allCategories.length + index,
                        children: [],
                    },
                    apiVersion: "content.halo.run/v1alpha1",
                    kind: "Category",
                    metadata: { name: "", generateName: "category-" },
                }
            )
        );

        const newCategories = await Promise.all(promises);

        const existNames = displayNames
            .map(name => {
                const found = allCategories.find(item => item.spec.displayName === name);
                return found ? found.metadata.name : undefined;
            })
            .filter(Boolean);

        return [
            ...existNames,
            ...newCategories.map(item => item.data.metadata.name),
        ];
    }

    async getCategoryDisplayNames(names) {
        const categories = await this.getCategories();
        return names
            ?.map(name => {
                const found = categories.find(item => item.metadata.name === name);
                return found ? found.spec.displayName : undefined;
            })
            .filter(Boolean);
    }


    async getCategories() {
        const categoriesResponse = await this.apiClient.get("/apis/content.halo.run/v1alpha1/categories");

        const categories = categoriesResponse.data;
        return Promise.resolve(categories.items);
    }


    async getTagNames(displayNames) {
        const allTags = await this.getTags();

        const notExistDisplayNames = displayNames.filter(
            name => !allTags.find(item => item.spec.displayName === name)
        );

        const promises = notExistDisplayNames.map(name =>
            this.apiClient.post("/apis/content.halo.run/v1alpha1/tags", {
                spec: {
                    displayName: name,
                    slug: slugify(name, { trim: true }),
                    color: "#ffffff",
                    cover: "",
                },
                apiVersion: "content.halo.run/v1alpha1",
                kind: "Tag",
                metadata: { name: "", generateName: "tag-" },
            })
        );

        const newTags = await Promise.all(promises);

        const existNames = displayNames
            .map(name => {
                const found = allTags.find(item => item.spec.displayName === name);
                return found ? found.metadata.name : undefined;
            })
            .filter(Boolean);

        return [...existNames, ...newTags.map(item => item.data.metadata.name)];
    }


    async getTagDisplayNames(names) {
        const tags = await this.getTags();
        return names
            ?.map(name => {
                const found = tags.find(item => item.metadata.name === name);
                return found ? found.spec.displayName : undefined;
            })
            .filter(Boolean);
    }

    async getAttachmentPermalink(name) {
        const policyResponse = await this.apiClient.get(`/apis/storage.halo.run/v1alpha1/policies/${this.site.attachment.policy}`);

        const policy = policyResponse.data;

        return new Promise((resolve, reject) => {
            const fetchPermalink = () => {
                this.apiClient
                    .get(`/apis/storage.halo.run/v1alpha1/attachments/${name}`)
                    .then(response => {
                        const permalink = response.data.status.permalink;
                        if (permalink) {
                            if (policy.spec.templateName === "local") {
                                resolve(`${this.site.url}${permalink}`);
                            } else {
                                resolve(permalink);
                            }
                        } else {
                            setTimeout(fetchPermalink, 1000);
                        }
                    })
                    .catch(error => reject(error));
            };
            fetchPermalink();
        });
    }


}



const p = new PostContent();
p.sync();

