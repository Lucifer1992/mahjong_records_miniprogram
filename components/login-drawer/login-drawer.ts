// components/login-drawer/login-drawer.ts
// 全局登录抽屉：浏览不受限，触发需要登录的功能时从底部弹出
import { wxLogin, setToken, uploadAvatar, updateProfile } from '../../utils/api';
import { setTier } from '../../utils/tier';
import { bootSync } from '../../utils/sync';
import { getRecords } from '../../utils/storage';
import { markPromptDismissed } from '../../utils/auth';

Component({
  data: {
    visible: false,
    loading: false,
    avatarPath: '',   // chooseAvatar 返回的本地临时路径（预览用）
    nickname: ''      // type=nickname 输入的昵称
  },

  methods: {
    /** 微信官方头像填写能力：用户点选后返回临时文件路径 */
    onChooseAvatar(e: { detail: { avatarUrl: string } }) {
      if (e.detail && e.detail.avatarUrl) {
        this.setData({ avatarPath: e.detail.avatarUrl });
      }
    },

    onNicknameInput(e: { detail: { value: string } }) {
      this.setData({ nickname: (e.detail.value || '').trim() });
    },
    /** 页面通过 selectComponent('#loginDrawer').show() 拉起 */
    show() {
      if (this.data.visible) return;
      this.setData({ visible: true });
    },

    hide() {
      markPromptDismissed(); // 用户主动关过，本次启动不再自动弹，只在功能操作/401 时再弹
      this.setData({ visible: false });
    },

    onMaskTap() {
      this.hide();
    },

    noop() { /* 挡住抽屉内部的冒泡，避免点内容区触发 onMaskTap */ },

    /** 微信一键登录：wx.login 拿 code → （可选）传头像 → 后端换 token */
    async onLoginTap() {
      if (this.data.loading) return;
      this.setData({ loading: true });

      try {
        const loginRes = await new Promise<WechatMiniprogram.LoginRes>((resolve, reject) => {
          wx.login({ success: resolve, fail: reject });
        });
        if (!loginRes.code) throw new Error('wx.login 未返回 code');

        // 头像上传依赖 token，所以先登录换 token、再补传头像更新资料：
        // 1) 先带昵称登录（头像留空）
        const first = await wxLogin(loginRes.code, this.data.nickname || undefined);
        setToken(first.token);
        if (first.user && first.user.tier) setTier(first.user.tier);

        // 2) 用户选了头像 → 用新 token 上传，再 PATCH 资料落库
        if (this.data.avatarPath) {
          try {
            const { url: avatarUrl } = await uploadAvatar(this.data.avatarPath);
            await updateProfile({ avatar: avatarUrl });
          } catch (e) {
            console.warn('[login-drawer] 头像上传失败（不阻断登录）', e);
          }
        }

        wx.showToast({ title: '登录成功', icon: 'success', duration: 800 });

        // 首次同步不阻塞收抽屉
        bootSync(getRecords()).catch(() => { /* 静默 */ });

        setTimeout(() => {
          this.setData({ visible: false, avatarPath: '', nickname: '' });
          this.triggerEvent('loggedin');
        }, 400);
      } catch (e: any) {
        console.warn('[login-drawer] 登录失败', e);
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      } finally {
        this.setData({ loading: false });
      }
    },

    onPrivacyTap() {
      wx.navigateTo({ url: '/pages/agreement/privacy' });
    },

    onTermsTap() {
      wx.navigateTo({ url: '/pages/agreement/terms' });
    }
  }
});
