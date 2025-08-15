# Kids-style SQL Simulator

一个纯前端的、少儿风格（类似 Scratch / code.org）的 SQL 学习模拟器，帮助初学者通过拖拽积木和编写简单 SQL 代码学习数据库概念与查询操作。

A pure Fronted, children styled SQL learning environment.

## Version 1.0.0 更新 2025.08.15

### 🚀 核心功能扩展
- **SQL 引擎升级**
  - 新增 `UPDATE` 语句支持（`SET col = expr`、`SET col = col + 1` 等，支持 `WHERE` 条件）。
  - 错误提示信息扩展为：`CREATE / INSERT / SELECT / UPDATE`。
  - 删除未使用的 `evalHaving()` 方法，精简代码。
  - 增强 `SELECT` 支持：可解析 `AS` 别名、`COUNT(*)`、`AVG()`、`GROUP BY`、`ORDER BY` 等。

- **数据录入与建表联动**
  - 将“加数据”模块与“创建表”模块合并，字段变化和 SQL 预览实时同步。
  - 支持批量添加多行数据，并实时生成 `INSERT` 语句。
  - 仅在表已创建的情况下允许插入数据。

### 🎨 UI 与布局优化
- **布局调整**
  - 调整 `SampleDB` 与 `ResultTable` 高度一致，避免大块空白。
  - `ResultTable` 自适应 `minHeight`，确保至少 10 行数据无需滚动。
  - 调整 CSS，避免内容溢出。

- **交互优化**
  - 查询区字体放大，突出 SQL 语句。
  - `PlayLab` 初始不显示数据表。
  - `maxRows` 自动与数据行数同步。

## 功能概述

本模拟器分为两个主要页面：

### 1. **创造模式视图（Create + Query）**
- **建表模块**：
  - 积木拖拽式建表（可切换到代码模式）
  - 自定义表名、列名、数据类型、主键
  - 可添加初始数据行
- **查询模块**：
  - 仅在建表后启用
  - 支持的 SQL：`SELECT`、`WHERE`（多条件）、`ORDER BY`、`JOIN`、`GROUP BY`
  - 查询结果实时显示

### 2. **示例数据库视图（Sample DB Playground）**
- 内置示例数据库，无需建表即可直接练习 SQL 查询
- 示例数据库：
  - **people** 表：
    ```
    id INTEGER PRIMARY KEY,
    name TEXT,
    age INTEGER,
    dept_id INTEGER
    ```
    示例数据：
    ```
    (1, 'Alice', 25, 1)
    (2, 'Bob', 30, 2)
    (3, 'Cathy', 22, 1)
    (4, 'David', 35, 3)
    ```
  - **dept** 表：
    ```
    id INTEGER PRIMARY KEY,
    dept_name TEXT
    ```
    示例数据：
    ```
    (1, 'Engineering')
    (2, 'Marketing')
    (3, 'HR')
    ```

- 示例查询：
```sql
SELECT p.name, d.dept_name
FROM people p
JOIN dept d ON p.dept_id = d.id
WHERE age > 25
ORDER BY dept_name;
```
```sql
SELECT dept_name, COUNT(*) as cnt, AVG(age) as avg_age
FROM people p
JOIN dept d ON p.dept_id = d.id
GROUP BY dept_name
HAVING cnt > 1;
```

## 技术特点
- **纯前端实现**，无需后端支持
- 样式借鉴 Scratch / code.org 少儿编程风格
- 内存数据库模拟，数据刷新后可重置

## 后续扩展计划
- 增加 `UPDATE` / `DELETE` 支持
- 多表 JOIN（链式 JOIN）
- 积木式 SELECT / JOIN 组装器
- 本地存储保存/加载数据库
- 导出 CSV / SQL 脚本
