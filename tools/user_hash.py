# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# 用户身份字段的统一规范化入口。
#
# 该项目用于个人本地分析，用户 ID 与昵称按采集结果原文保存。保留原有
# 函数名是为了兼容各平台现有调用点和已有数据结构，函数本身不再执行哈希
# 或字符遮盖。


def preserve_user_id(user_id) -> str:
    """返回规范化后的原始用户 ID。"""
    if user_id is None:
        return ""
    s = str(user_id).strip()
    if not s:
        return ""
    return s


def preserve_nickname(name) -> str:
    """返回原始昵称文本。"""
    if name is None:
        return ""
    return str(name)


# 向后兼容外部脚本；项目内部不再使用带有“匿名/脱敏”含义的旧名称。
anonymize_user_id = preserve_user_id
mask_nickname = preserve_nickname
