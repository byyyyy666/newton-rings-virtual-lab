# 牛顿环薄膜干涉虚拟仿真实验平台

这是一个可直接部署到 GitHub Pages 的静态网站，包含三维仪器观察、实验操作、创新实验实时演示、编码器过程档案、最小二乘法数据处理和预习自测。

这是用于逐文件上传的精简版：仪器旋转采用 4 个关键视角，共 44 个文件，约 39 MiB。原 `assets` 已拆成 `assets-core` 和 `assets-instruments` 两个目录；三维依赖已合并到 `libs`，不需要单独上传 `utils` 文件夹。

部署后打开 `你的网址/check.html`，页面会逐项检查三维模块、实时演示、视频和依赖文件。出现“失败”就表示对应路径没有上传成功。

## 推荐仓库名

```text
newton-rings-virtual-lab
```

部署成功后，网站地址格式为：

```text
https://你的GitHub用户名.github.io/newton-rings-virtual-lab/
```

## 上传到 GitHub

1. 在 GitHub 新建一个公开仓库，例如 `newton-rings-virtual-lab`。
2. 将本目录内的全部文件上传到仓库根目录。
3. 确认 `index.html` 位于仓库最外层。
4. 打开仓库的 `Settings`。
5. 进入 `Pages`。
6. 在 `Build and deployment` 的 `Source` 中选择 `Deploy from a branch`。
7. 分支选择 `main`，目录选择 `/ (root)`。
8. 点击 `Save`，等待 GitHub Pages 完成部署。
9. 在 `Settings > Pages` 中查看生成的网址。

不需要上传 `.github` 或 `.nojekyll` 文件，发布目录中的所有文件都可以直接在资源管理器中看到。

## 发布后修改搜索地址

把下面两个文件中的占位内容替换成真实用户名和仓库名：

```text
YOUR_GITHUB_USERNAME
YOUR_REPOSITORY
```

需要修改：

- `robots.txt`
- `sitemap.xml`

例如：

```text
https://yourname.github.io/newton-rings-virtual-lab/
```

## 让搜索引擎收录

GitHub Pages 生成网址后，搜索引擎不会立即收录。建议完成以下步骤：

1. 确认网站可以匿名公开访问。
2. 在 Google Search Console 添加该网址并验证所有权。
3. 提交 `sitemap.xml`。
4. 在 Bing Webmaster Tools 提交相同网址和站点地图。
5. 在 GitHub 仓库的 `About` 中填写网站地址、简介和主题标签。
6. 通过公开页面链接访问几次，等待搜索引擎抓取。

推荐仓库简介：

```text
牛顿环薄膜干涉虚拟仿真实验平台，包含三维仪器、交互读数、实时采集、过程档案和最小二乘法数据处理。
```

推荐主题标签：

```text
physics-simulation
newton-rings
virtual-lab
education
github-pages
```

搜索引擎通常需要数天到数周完成首次收录。若希望更快访问，应直接使用 GitHub Pages 网址。

## 本地预览

在本目录运行：

```powershell
python -m http.server 8000
```

然后打开：

```text
http://127.0.0.1:8000/
```

不要直接双击 `index.html`。摄像头、ES Module 和三维模型需要通过 HTTP 或 HTTPS 加载。

