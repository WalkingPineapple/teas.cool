---
title: LL学习的偷鸡记录
date: '2023-03-31'
summary: 某APP中设有某LL学习的版块，有许多的KPI需要完成，这谁顶得住啊，不得找个方法偷鸡
tags:
  - Packet Capture
  - 花里胡哨
  - MITM
author: P1neapple
type: writing
---
**只提供思路，本文章不具有任何指导意义,相关信息已经脱敏**



## 思路


抓包，简单粗暴

### 用户流程分析

	1.用户打开模块，查看待学习任务
	2.用户选择学习任务，开始学习
	3.学习完成提示已完成并记录学习情况

显而易见，必须有一个请求是获取学习任务列表的接口，抓了一把，找到请求URL如下：

```
https://xx.xxxxxxx.xx:xxxx/theory_server/api/IndexController_pullDownRefreshMediaPg?xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

查看其响应，如下：

```json



    "map": {

        "mediaList": [

            {

                "id": "424a7d9d-xxxx-4cc6-8089-xxxxxxxxxxx",
				 ...............
                

            },
            .........
            ]
            }
```

其中的ID应该是每个任务的ID

当用户学习完成之后，应该会有一个请求告诉服务端已经学习完成，继续抓一把，找到URL如下：

```
https://xx.xxxxxxx.xx:xxxx:xxxx/theory_server/api/StudyController_FinishInfo?
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

其中请求体中，包含以下信息：

```
ArticleId=f424a7d9d-782c-xxxx-8089-xxxxxxxxxxx
```

那大致思路就很明显了,只需要通过MITM就可以完成，具体的操作细节不做描述啦。

溜了溜了，任何花里胡哨都将被绳之以法。
